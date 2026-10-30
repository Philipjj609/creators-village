import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { validateSessionHash } from "../apps/server/src/session-validation.js";
import { encrypt, decrypt, hash } from "../apps/server/src/security.js";
import {
  ProviderError,
  type TwitchGateway,
} from "../apps/server/src/twitch.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf2_auth_test";
const pool = createPool(url.toString()),
  other = createPool(url.toString()),
  key = "f".repeat(64);
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_wf2_auth_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people CASCADE");
});
afterAll(async () => {
  await pool.end();
  await other.end();
  await admin.end();
});
async function fixture() {
  const id = randomUUID(),
    session = hash(randomUUID());
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name) VALUES($1,$2,$3)",
    [id, id, "Synthetic validation test"],
  );
  await pool.query(
    "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,validated_at,expires_at) VALUES($1,$2,'csrf',$3,now()-interval '1 second',now()-interval '61 minutes',now()+interval '1 day')",
    [
      session,
      id,
      encrypt(
        { access_token: "old", refresh_token: "old", expires_in: 3600 },
        key,
      ),
    ],
  );
  return { id, session };
}
it("E09: separate process pools coalesce refresh with a fenced lease, without holding a connection over provider calls", async () => {
  const f = await fixture();
  let refreshes = 0,
    validations = 0;
  const provider: TwitchGateway = {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      refreshes++;
      await new Promise((r) => setTimeout(r, 80));
      expect(pool.waitingCount).toBe(0);
      return {
        access_token: "new",
        refresh_token: "rotated",
        expires_in: 7200,
      };
    },
    validate: async () => {
      validations++;
      return {
        subject: f.id,
        displayName: "Synthetic test",
        login: "synthetic",
      };
    },
  };
  const [a, b] = await Promise.all([
    validateSessionHash(pool, provider, key, f.session),
    validateSessionHash(other, provider, key, f.session),
  ]);
  expect(a?.person_id).toBe(f.id);
  expect(b?.person_id).toBe(f.id);
  expect(refreshes).toBe(1);
  expect(validations).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT validation_lease FROM sessions WHERE session_hash=$1",
        [f.session],
      )
    ).rows[0].validation_lease,
  ).toBeNull();
});
it("E09: a stale read cannot claim validation after another pool just completed it", async () => {
  const f = await fixture();
  let started!: () => void,
    release!: () => void,
    validations = 0;
  const ready = new Promise<void>((resolve) => (started = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const provider: TwitchGateway = {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => ({
      access_token: "rotated",
      refresh_token: "rotated",
      expires_in: 7200,
    }),
    validate: async () => {
      validations++;
      started();
      await gate;
      return {
        subject: f.id,
        displayName: "Synthetic test",
        login: "synthetic",
      };
    },
  };
  const first = validateSessionHash(pool, provider, key, f.session);
  await ready;
  const original = other.query;
  let intercepted = false;
  other.query = (async (...args: unknown[]) => {
    if (
      !intercepted &&
      typeof args[0] === "string" &&
      args[0].startsWith("UPDATE sessions SET validation_lease=$1")
    ) {
      intercepted = true;
      release();
      await first;
    }
    return (original as (...parameters: unknown[]) => unknown).apply(
      other,
      args,
    );
  }) as typeof other.query;
  try {
    const second = await validateSessionHash(other, provider, key, f.session);
    expect(second?.person_id).toBe(f.id);
    expect(intercepted).toBe(true);
    expect(validations).toBe(1);
  } finally {
    release();
    other.query = original;
    await first;
  }
});
it("E09: outage after token rotation preserves rotated refresh token but never extends authorization freshness", async () => {
  const f = await fixture();
  let refreshes = 0,
    fail = true;
  const provider: TwitchGateway = {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      refreshes++;
      return {
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 7200,
      };
    },
    validate: async () => {
      if (fail) throw new ProviderError(503);
      return { subject: f.id, displayName: "Synthetic test" };
    },
  };
  await expect(
    validateSessionHash(pool, provider, key, f.session),
  ).rejects.toMatchObject({ status: 503 });
  const row = (
    await pool.query("SELECT * FROM sessions WHERE session_hash=$1", [
      f.session,
    ])
  ).rows[0];
  expect(
    decrypt<{ refresh_token: string }>(row.encrypted_tokens, key).refresh_token,
  ).toBe("fresh-refresh");
  expect(Date.now() - row.validated_at.getTime()).toBeGreaterThan(3600000);
  fail = false;
  expect(
    (await validateSessionHash(other, provider, key, f.session))?.person_id,
  ).toBe(f.id);
  expect(refreshes).toBe(1);
});
it("E09: logout during validation cannot revive a session; definitive invalidation removes only the fenced generation", async () => {
  const f = await fixture();
  const provider: TwitchGateway = {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => ({
      access_token: "fresh",
      refresh_token: "fresh",
      expires_in: 7200,
    }),
    validate: async () => {
      await other.query("DELETE FROM sessions WHERE session_hash=$1", [
        f.session,
      ]);
      return { subject: f.id, displayName: "Synthetic" };
    },
  };
  expect(await validateSessionHash(pool, provider, key, f.session)).toBeNull();
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM sessions WHERE session_hash=$1",
        [f.session],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("E09: a fresh force-validation flight is not bypassed by a second process while definitive invalidation is pending", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE sessions SET token_expires_at=now()+interval '2 hours',validated_at=now() WHERE session_hash=$1",
    [f.session],
  );
  const provider: TwitchGateway = {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      await new Promise((r) => setTimeout(r, 100));
      throw new ProviderError(401);
    },
  };
  const result = await Promise.all([
    validateSessionHash(pool, provider, key, f.session, true),
    validateSessionHash(other, provider, key, f.session, true),
  ]);
  expect(result).toEqual([null, null]);
});
