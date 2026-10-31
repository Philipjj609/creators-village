import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import { publishFounding } from "../apps/server/src/founding.js";
import { generateBaseline } from "../packages/world/src/founding.js";
import { generateWorld } from "../packages/world/src/index.js";
import { readLivingVillage } from "../apps/server/src/living.js";
import { hash, encrypt, randomToken } from "../apps/server/src/security.js";
import type { Config } from "../apps/server/src/config.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw Error("LW1 tests require isolated loopback PG");
const admin = createPool(url.toString());
url.pathname = "/creators_village_lw1_test";
const pool = createPool(url.toString()),
  owner = randomUUID(),
  world = randomUUID();
const raw = randomToken(),
  cookie = "cv_session=" + raw;
const config: Config = {
  databaseUrl: url.toString(),
  clientId: "test",
  clientSecret: "test",
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  webOrigin: "http://localhost:5173",
  encryptionKey: "d".repeat(64),
  secureCookies: false,
  wf2WorldId: world,
};
let app: Awaited<ReturnType<typeof buildApp>>, before: string;
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_lw1_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people CASCADE");
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,'fixture-lw1','Synthetic owner','synthetic_lw1')",
    [owner],
  );
  await pool.query(
    "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '1 day')",
    [
      hash(raw),
      owner,
      "lw1-csrf",
      encrypt(
        { access_token: "fake", refresh_token: "fake", expires_in: 7200 },
        config.encryptionKey,
      ),
    ],
  );
  const job = randomUUID(),
    lease = new Date(Date.now() + 30000).toISOString();
  const legacy = generateWorld("fern", {
    id: randomUUID(),
    name: "Synthetic legacy",
    createdAt: new Date().toISOString(),
    source: "creator",
  });
  await pool.query(
    "INSERT INTO worlds(id,creator_id,name,seed,generator_version,asset_version,schema_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
    [
      legacy.id,
      owner,
      legacy.name,
      legacy.seed,
      legacy.generatorVersion,
      legacy.assetVersion,
      legacy,
    ],
  );
  await pool.query(
    "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,'Synthetic LW1','fern','development','working',$6)",
    [job, owner, randomUUID(), hash("lw1-fixture"), world, lease],
  );
  await publishFounding(pool, job, generateBaseline("fern"), lease);
  before = JSON.stringify(
    (
      await pool.query(
        "SELECT header,baseline_hash FROM founding_worlds WHERE id=$1",
        [world],
      )
    ).rows,
  );
  app = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("No provider");
    },
    refresh: async () => {
      throw Error("No provider");
    },
    validate: async () => ({
      subject: "fixture-lw1",
      displayName: "Synthetic owner",
      login: "synthetic_lw1",
    }),
  });
}, 30000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
it("serves real persisted terrain privately, with no identity or construction writes", async () => {
  const path = `/api/founding/${world}/residents`;
  expect((await app.inject(path)).statusCode).toBe(404);
  expect(await readLivingVillage(pool, world, randomUUID())).toBeNull();
  const r = await app.inject({ url: path, headers: { cookie } });
  expect(r.statusCode).toBe(200);
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.json().residents).toHaveLength(4);
  expect(JSON.stringify(r.json())).not.toMatch(
    /twitch|Synthetic owner|token|personId/,
  );
  const reopened = await readLivingVillage(pool, world, owner);
  expect(reopened!.residents).toEqual(r.json().residents);
  expect(
    JSON.stringify(
      (
        await pool.query(
          "SELECT header,baseline_hash FROM founding_worlds WHERE id=$1",
          [world],
        )
      ).rows,
    ),
  ).toBe(before);
  expect((await pool.query("SELECT count(*) FROM people")).rows[0].count).toBe(
    "1",
  );
  expect(
    (await pool.query("SELECT count(*) FROM wf2_contributions")).rows[0].count,
  ).toBe("0");
});
it("preserves WF2 access fences and reroutes from saved reservation cells", async () => {
  const result = await app.inject({
    method: "POST",
    url: `/api/wf2/worlds/${world}/commands`,
    headers: { cookie, origin: config.webOrigin, "x-csrf-token": "lw1-csrf" },
    payload: {
      commandId: randomUUID(),
      commandSchema: "wf2-command-1",
      kind: "EnablePlaytest",
      payload: { expectedBaselineHash: JSON.parse(before)[0].baseline_hash },
    },
  });
  expect(result.statusCode).toBe(200);
  expect(
    (await app.inject(`/api/founding/${world}/residents`)).statusCode,
  ).toBe(404);
  const prior = await readLivingVillage(pool, world, owner);
  // Extra protected founding cell models an authoritative claim independent of visuals.
  const p = prior!.residents[0]!.goals!.find((g) => g.id === "work")!.position;
  await pool.query(
    "INSERT INTO founding_occupancy(world_id,surface,hx,hy,structure_id) VALUES($1,'ground',$2,$3,'founding-shelter')",
    [world, Math.floor(p.x * 2), Math.floor(p.y * 2)],
  );
  const next = await readLivingVillage(pool, world, owner);
  for (const r of next!.residents)
    for (const route of r.routes!)
      for (const q of route.points)
        expect([Math.floor(q.x * 2), Math.floor(q.y * 2)]).not.toEqual([
          Math.floor(p.x * 2),
          Math.floor(p.y * 2),
        ]);
  expect(next!.baselineHash).toBe(prior!.baselineHash);
  expect(
    (
      await app.inject({
        url: `/api/founding/${world}/residents`,
        headers: { cookie },
      })
    ).statusCode,
  ).toBe(200);
});
it("honors actual published WF2 reservations and disabled bindings without changing construction", async () => {
  const send = (kind: string, payload: object) =>
    app.inject({
      method: "POST",
      url: `/api/wf2/worlds/${world}/commands`,
      headers: { cookie, origin: config.webOrigin, "x-csrf-token": "lw1-csrf" },
      payload: {
        commandId: randomUUID(),
        commandSchema: "wf2-command-1",
        kind,
        payload,
      },
    });
  const draft = await send("CreateDraft", { site: { qx: 1792, qy: 1280 } });
  expect(draft.statusCode, draft.body).toBe(200);
  const p = draft.json().result;
  const published = await send("PublishProject", {
    projectId: p.projectId,
    expectedProjectRevision: "1",
    planHash: p.planHash,
  });
  expect(published.statusCode, published.body).toBe(200);
  const claims = new Set(
    (
      await pool.query(
        "SELECT hx,hy FROM wf2_claims WHERE world_id=$1 AND kind='reserved'",
        [world],
      )
    ).rows.map((r) => `${r.hx},${r.hy}`),
  );
  expect(claims.size).toBeGreaterThan(0);
  const plan = await readLivingVillage(pool, world, owner);
  expect(plan!.residents).toHaveLength(4);
  for (const r of plan!.residents)
    for (const route of r.routes!) {
      expect(
        r.goals!.some((g) => g.structureId?.startsWith("wf2-workshop-")),
      ).toBe(false);
      for (const q of route.points)
        expect(
          claims.has(`${Math.floor(q.x * 2)},${Math.floor(q.y * 2)}`),
        ).toBe(false);
    }
  expect(
    (
      await pool.query(
        "SELECT state,accepted_count FROM wf2_projects WHERE id=$1",
        [p.projectId],
      )
    ).rows[0],
  ).toEqual({ state: "open", accepted_count: 0 });
  await pool.query("UPDATE wf2_bindings SET enabled=false WHERE world_id=$1", [
    world,
  ]);
  expect(await readLivingVillage(pool, world, owner)).toBeNull();
  await pool.query("UPDATE wf2_bindings SET enabled=true WHERE world_id=$1", [
    world,
  ]);
});
