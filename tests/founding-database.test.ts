import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import {
  publishFounding,
  foundingRunner,
  withTopologyGuard,
} from "../apps/server/src/founding.js";
import { generateBaseline } from "../packages/world/src/founding.js";
import { reachable } from "../packages/world/src/founding-spatial.js";
import { hash } from "../apps/server/src/security.js";
import type { Config } from "../apps/server/src/config.js";
import type { TwitchGateway } from "../apps/server/src/twitch.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf1_test";
const pool = createPool(url.toString());
const config: Config = {
  databaseUrl: url.toString(),
  clientId: "test",
  clientSecret: "test-only",
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  webOrigin: "http://localhost:5173",
  encryptionKey: "b".repeat(64),
  secureCookies: false,
};
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_wf1_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query(
    "TRUNCATE founding_occupancy,founding_structures,founding_chunks,founding_paths,founding_public_events,founding_worlds,founding_jobs,world_events,create_receipts,worlds,sessions,oauth_states,people CASCADE",
  );
});
afterAll(async () => {
  await pool.end();
  await admin.end();
});
async function login() {
  const subject = randomUUID();
  const provider: TwitchGateway = {
    exchange: async () => ({
      access_token: "test",
      refresh_token: "test",
      expires_in: 7200,
    }),
    refresh: async () => ({
      access_token: "test",
      refresh_token: "test",
      expires_in: 7200,
    }),
    validate: async () => ({ subject, displayName: "Test creator" }),
  };
  const app = await buildApp(config, pool, provider);
  const start = await app.inject("/auth/twitch"),
    state = new URL(start.headers.location!).searchParams.get("state")!;
  const callback = await app.inject({
    url: "/auth/twitch/callback?state=" + state + "&code=test",
    headers: { cookie: "cv_oauth_state=" + state },
  });
  const cookie = (callback.headers["set-cookie"] as string[])
    .find((c) => c.startsWith("cv_session="))!
    .split(";")[0]!;
  const me = (await app.inject({ url: "/api/me", headers: { cookie } })).json()
    .person;
  return {
    app,
    provider,
    cookie,
    headers: { cookie, origin: config.webOrigin, "x-csrf-token": me.csrfToken },
  };
}
async function waitReady(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  id: string,
) {
  for (let i = 0; i < 100; i++) {
    const r = (
      await app.inject({ url: "/api/founding-jobs/" + id, headers: { cookie } })
    ).json();
    if (r.status === "ready") return r;
    if (r.status === "failed") throw Error(r.error);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("job timeout");
}
it("publishes one certified v2 atomically, durable original acceptance, bounded chunks, auth and restart recovery", async () => {
  const s = await login();
  try {
    const body = {
      commandId: randomUUID(),
      name: "A Real Beginning",
      seed: "fern",
      development: false,
    };
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/founding",
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        s.app.inject({
          method: "POST",
          url: "/api/founding",
          headers: s.headers,
          payload: body,
        }),
      ),
    );
    expect(replies.map((r) => r.statusCode)).toEqual([202, 202, 202, 202]);
    const accepted = replies[0]!.json();
    expect(replies.every((r) => r.body === replies[0]!.body)).toBe(true);
    await waitReady(s.app, s.cookie, accepted.jobId);
    const w = (await s.app.inject("/api/founding/" + accepted.worldId)).json();
    expect(w.structure.id).toBe("founding-shelter");
    expect(w.baseline.certificate.opportunities).toBe(8);
    expect(w.publicCursor).toBe("1");
    expect(w).not.toHaveProperty("buildings");
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/founding",
          headers: s.headers,
          payload: body,
        })
      ).json(),
    ).toEqual(accepted);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/founding",
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
          headers: s.headers,
          payload: { commandId: randomUUID(), name: "Other", seed: "x" },
        })
      ).statusCode,
    ).toBe(409);
    const chunks = await s.app.inject(
      "/api/founding/" + w.id + "/chunks?keys=-1,0;0,0",
    );
    expect(chunks.statusCode).toBe(200);
    expect(chunks.json().chunks).toHaveLength(2);
    expect(chunks.body).not.toMatch(/creator_id|person_id|csrf|token/);
    const count = await pool.query(
      "SELECT (SELECT count(*) FROM founding_chunks WHERE world_id=$1)::int AS chunks,(SELECT count(*) FROM founding_occupancy WHERE world_id=$1)::int AS claims",
      [w.id],
    );
    expect(count.rows[0]).toEqual({ chunks: 256, claims: 24 });
    await s.app.close();
    const fresh = createPool(url.toString()),
      restarted = await buildApp(config, fresh, s.provider);
    try {
      expect((await restarted.inject("/api/founding/" + w.id)).json()).toEqual(
        w,
      );
      expect(
        (
          await restarted.inject(
            "/api/founding/" + w.id + "/chunks?keys=-1,0;0,0",
          )
        ).body,
      ).toBe(chunks.body);
    } finally {
      await restarted.close();
      await fresh.end();
    }
  } finally {
    await s.app.close();
  }
});
it("retains v1 byte-equivalent save and private explicit v2 development slot; no unrestricted multi-world", async () => {
  const s = await login();
  try {
    const v1 = await s.app.inject({
      method: "POST",
      url: "/api/villages",
      headers: s.headers,
      payload: {
        commandId: randomUUID(),
        name: "Legacy Grove",
        seed: "legacy",
      },
    });
    expect(v1.statusCode).toBe(200);
    const before = hash(v1.body);
    const body = {
      commandId: randomUUID(),
      name: "Development Clearing",
      seed: "willow",
      development: true,
    };
    const accepted = (
      await s.app.inject({
        method: "POST",
        url: "/api/founding",
        headers: s.headers,
        payload: body,
      })
    ).json();
    await waitReady(s.app, s.cookie, accepted.jobId);
    expect(
      (await s.app.inject("/api/founding/" + accepted.worldId)).statusCode,
    ).toBe(404);
    expect(
      (
        await s.app.inject({
          url: "/api/founding/" + accepted.worldId,
          headers: { cookie: s.cookie },
        })
      ).json().purpose,
    ).toBe("development");
    expect(
      hash((await s.app.inject("/api/villages/" + v1.json().id)).body),
    ).toBe(before);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/founding",
          headers: s.headers,
          payload: { ...body, commandId: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    const me = (
      await s.app.inject({ url: "/api/me", headers: { cookie: s.cookie } })
    ).json().person;
    expect(me.worldId).toBe(v1.json().id);
    expect(me.developmentWorldId).toBe(accepted.worldId);
  } finally {
    await s.app.close();
  }
});
it("topology guard prevents disjoint route write skew and does not block independent non-topology rows", async () => {
  const id = (await pool.query("SELECT id FROM founding_worlds LIMIT 1"))
    .rows[0]!.id;
  // Test-only two corridors, not a public construction command or gameplay permission.
  await pool.query(
    "CREATE TABLE IF NOT EXISTS wf1_test_obstacles(world_id uuid,x int,y int,PRIMARY KEY(world_id,x,y))",
  );
  await pool.query("DELETE FROM wf1_test_obstacles");
  const attempts = await Promise.all(
    [1, 3].map((x) =>
      withTopologyGuard(pool, id, async (db) => {
        const solids = (
          await db.query(
            "SELECT x,y FROM wf1_test_obstacles WHERE world_id=$1",
            [id],
          )
        ).rows;
        const grid = new Uint8Array(25);
        for (let y = 0; y < 5; y++)
          for (let xx = 0; xx < 5; xx++)
            if (y !== 2 || xx === 1 || xx === 3) grid[y * 5 + xx] = 1;
        for (const p of [...solids, { x, y: 2 }]) grid[p.y * 5 + p.x] = 0;
        const possible = reachable(
          { grid, min: 0, n: 5 },
          { x: 0.25, y: 0.25 },
          [{ x: 0.25, y: 2.25 }],
        );
        if (!possible) return false;
        await db.query("INSERT INTO wf1_test_obstacles VALUES($1,$2,2)", [
          id,
          x,
        ]);
        return true;
      }),
    ),
  );
  expect(attempts.filter(Boolean)).toHaveLength(1);
  const lock = await pool.connect();
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM founding_worlds WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const began = performance.now();
    await pool.query(
      "UPDATE people SET display_name=display_name WHERE id=(SELECT creator_id FROM founding_worlds WHERE id=$1)",
      [id],
    );
    expect(performance.now() - began).toBeLessThan(1000);
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
  }
});

it("rolls back mid-publication failure and recovers an expired worker lease without partial geography", async () => {
  const person = randomUUID(),
    job = randomUUID(),
    world = randomUUID(),
    lease = new Date(Date.now() + 30000).toISOString();
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name) VALUES($1,$2,'Recovery fixture')",
    [person, randomUUID()],
  );
  await pool.query(
    "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,'fixture',$4,'Recovered Clearing','recovery','active','working',$5)",
    [job, person, randomUUID(), world, lease],
  );
  const broken = generateBaseline("recovery");
  broken.chunks.at(-1)!.heights[0] = 40000;
  await expect(publishFounding(pool, job, broken, lease)).rejects.toThrow();
  expect(
    (await pool.query("SELECT id FROM founding_worlds WHERE id=$1", [world]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT world_id FROM founding_chunks WHERE world_id=$1",
        [world],
      )
    ).rowCount,
  ).toBe(0);
  await pool.query(
    "UPDATE founding_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [job],
  );
  const runner = foundingRunner(pool);
  try {
    for (let i = 0; i < 50; i++) {
      const r = (
        await pool.query("SELECT status FROM founding_jobs WHERE id=$1", [job])
      ).rows[0];
      if (r.status === "ready") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(
      (await pool.query("SELECT status FROM founding_jobs WHERE id=$1", [job]))
        .rows[0].status,
    ).toBe("ready");
    const header = (
      await pool.query("SELECT header FROM founding_worlds WHERE id=$1", [
        world,
      ])
    ).rows[0].header;
    expect(header.baseline.hash).toBe(generateBaseline("recovery").hash);
    expect(
      (
        await pool.query(
          "SELECT cursor FROM founding_public_events WHERE world_id=$1",
          [world],
        )
      ).rows,
    ).toEqual([{ cursor: "1" }]);
  } finally {
    await runner.close();
  }
});
