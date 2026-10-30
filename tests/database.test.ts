import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import {
  ProviderError,
  type TwitchGateway,
} from "../apps/server/src/twitch.js";
import { revalidateSessions } from "../apps/server/src/session-startup.js";
import type { Config } from "../apps/server/src/config.js";
process.loadEnvFile(".local/runtime.env");
const baseUrl = new URL(process.env.DATABASE_URL!);
const admin = createPool(baseUrl.toString());
baseUrl.pathname = "/creators_village_test";
const pool = createPool(baseUrl.toString());
const config: Config = {
  databaseUrl: baseUrl.toString(),
  clientId: "test-app",
  clientSecret: "test-only",
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  webOrigin: "http://localhost:5173",
  encryptionKey: "a".repeat(64),
  secureCookies: false,
};
const people: string[] = [];
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
});
afterAll(async () => {
  for (const id of people) {
    await pool.query("DELETE FROM create_receipts WHERE person_id=$1", [id]);
    await pool.query(
      "DELETE FROM world_events WHERE world_id IN(SELECT id FROM worlds WHERE creator_id=$1)",
      [id],
    );
    await pool.query("DELETE FROM worlds WHERE creator_id=$1", [id]);
    await pool.query("DELETE FROM people WHERE id=$1", [id]);
  }
  await pool.end();
  await admin.end();
});
async function signedIn() {
  const subject = randomUUID();
  let revoked = false;
  const provider: TwitchGateway = {
    async exchange() {
      return {
        access_token: "fake-access",
        refresh_token: "fake-refresh",
        expires_in: 3600,
      };
    },
    async refresh() {
      return {
        access_token: "fake-access",
        refresh_token: "fake-refresh",
        expires_in: 3600,
      };
    },
    async validate() {
      if (revoked) throw new ProviderError(401);
      return { subject, displayName: "Private test identity" };
    },
  };
  const app = await buildApp(config, pool, provider);
  const start = await app.inject("/auth/twitch");
  const state = new URL(start.headers.location!).searchParams.get("state")!;
  const callback = await app.inject({
    url: "/auth/twitch/callback?state=" + state + "&code=test-code",
    headers: { cookie: "cv_oauth_state=" + state },
  });
  expect(callback.statusCode).toBe(302);
  const set = callback.headers["set-cookie"] as string[];
  const cookie = set.find((x) => x.startsWith("cv_session="))!.split(";")[0]!;
  const me = (await app.inject({ url: "/api/me", headers: { cookie } })).json()
    .person;
  const id = (
    await pool.query<{ id: string }>(
      "SELECT id FROM people WHERE twitch_subject=$1",
      [subject],
    )
  ).rows[0]!.id;
  people.push(id);
  return {
    app,
    cookie,
    me,
    id,
    provider,
    revoke() {
      revoked = true;
    },
    headers: { cookie, origin: config.webOrigin, "x-csrf-token": me.csrfToken },
  };
}
const input = () => ({
  commandId: randomUUID(),
  name: "Test Grove",
  seed: "db-fixture",
});
describe("S1 real PostgreSQL authority and recovery", () => {
  it("rejects anonymous creation and wrong OAuth state", async () => {
    const app = await buildApp(config, pool, {
      exchange: async () => {
        throw Error("should not exchange");
      },
      refresh: async () => {
        throw Error("unused");
      },
      validate: async () => {
        throw Error("unused");
      },
    });
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/villages",
            payload: input(),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: "/auth/twitch/callback?state=a&code=b",
            headers: { cookie: "cv_oauth_state=different" },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it("serializes simultaneous retries into one world/event and binds the receipt payload", async () => {
    const s = await signedIn();
    try {
      const body = input();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          s.app.inject({
            method: "POST",
            url: "/api/villages",
            headers: s.headers,
            payload: body,
          }),
        ),
      );
      expect(responses.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
      const ids = new Set(responses.map((r) => r.json().id));
      expect(ids.size).toBe(1);
      const id = responses[0]!.json().id;
      expect(
        (await pool.query("SELECT * FROM world_events WHERE world_id=$1", [id]))
          .rowCount,
      ).toBe(1);
      expect(
        (
          await s.app.inject({
            method: "POST",
            url: "/api/villages",
            headers: s.headers,
            payload: { ...body, seed: "changed" },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await s.app.inject({
            method: "POST",
            url: "/api/villages",
            headers: { ...s.headers, origin: "https://other.example" },
            payload: input(),
          })
        ).statusCode,
      ).toBe(403);
      const publicResponse = await s.app.inject("/api/villages/" + id);
      expect(publicResponse.statusCode).toBe(200);
      expect(publicResponse.body).not.toMatch(
        /twitch_subject|person_id|csrf|token|Private test/,
      );
      const persisted = (
        await pool.query("SELECT snapshot FROM worlds WHERE id=$1", [id])
      ).rows[0].snapshot;
      expect(publicResponse.json()).toEqual(persisted);
    } finally {
      await s.app.close();
    }
  });
  it("allows independent creators, protects one-world ownership and survives new app/pool instances", async () => {
    const a = await signedIn(),
      b = await signedIn();
    try {
      const results = await Promise.all(
        [a, b].map((s) =>
          s.app.inject({
            method: "POST",
            url: "/api/villages",
            headers: s.headers,
            payload: input(),
          }),
        ),
      );
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(results[0]!.json().id).not.toBe(results[1]!.json().id);
      expect(
        (
          await a.app.inject({
            method: "POST",
            url: "/api/villages",
            headers: a.headers,
            payload: input(),
          })
        ).statusCode,
      ).toBe(409);
      const fresh = createPool(baseUrl.toString()),
        restarted = await buildApp(config, fresh, a.provider);
      try {
        const restored = await restarted.inject(
          "/api/villages/" + results[0]!.json().id,
        );
        expect(restored.json()).toEqual(results[0]!.json());
      } finally {
        await restarted.close();
        await fresh.end();
      }
    } finally {
      await a.app.close();
      await b.app.close();
    }
  });
  it("invalidates revoked sessions on startup and denies mutation", async () => {
    const s = await signedIn();
    try {
      s.revoke();
      await revalidateSessions(pool, s.provider, config.encryptionKey);
      expect(
        (
          await s.app.inject({ url: "/api/me", headers: { cookie: s.cookie } })
        ).json().person,
      ).toBeNull();
      expect(
        (
          await s.app.inject({
            method: "POST",
            url: "/api/villages",
            headers: s.headers,
            payload: input(),
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await s.app.close();
    }
  });
});
