import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import {
  prepareHostedPlan,
  applyHostedPlan,
  hostedPlanHash,
  type HostedPlan,
} from "../apps/server/src/hosted-bootstrap.js";
import { hash, encrypt, randomToken } from "../apps/server/src/security.js";
import { generateBaseline } from "../packages/world/src/founding.js";
import { foundingRunner } from "../apps/server/src/founding.js";
import { buildApp } from "../apps/server/src/app.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!),
  admin = createPool(url.toString());
url.pathname = "/creators_village_hosted_bootstrap_test";
const pool = createPool(url.toString()),
  person = randomUUID(),
  key = "9".repeat(64),
  target = hash("isolated-target");
const subject = randomUUID(),
  sessionHash = hash(randomToken());
let plan: HostedPlan;
const provider = {
  exchange: async () => {
    throw Error("unused");
  },
  refresh: async () => {
    throw Error("unused");
  },
  validate: async () => ({
    subject,
    displayName: "Synthetic creator",
    login: "bootstrap_fixture",
  }),
};
it("keeps operator bootstrap commands and artifacts outside production HTTP routes", async () => {
  const app = await buildApp(
    {
      databaseUrl: url.toString(),
      clientId: "synthetic",
      clientSecret: "synthetic",
      redirectUri: "https://bootstrap.invalid/auth/twitch/callback",
      webOrigin: "https://bootstrap.invalid",
      encryptionKey: key,
      secureCookies: true,
      production: true,
      writesPaused: true,
    },
    pool,
    provider,
  );
  try {
    await app.ready();
    for (const route of [
      "/bootstrap",
      "/auth/bootstrap",
      "/api/bootstrap",
      "/api/hosted-bootstrap",
      "/scripts/hosted-bootstrap.mjs",
      "/apps/server/dist/hosted-bootstrap.js",
    ]) {
      expect(app.hasRoute({ method: "GET", url: route })).toBe(false);
      expect(app.hasRoute({ method: "POST", url: route })).toBe(false);
      expect((await app.inject({ method: "GET", url: route })).statusCode).toBe(
        404,
      );
    }
  } finally {
    await app.close();
  }
});
const prepare = () =>
  prepareHostedPlan(pool, provider, key, {
    target,
    login: "bootstrap_fixture",
    name: "Hosted test clearing",
    seed: "fern",
  });
const apply = (p = plan, extra = {}) =>
  applyHostedPlan(pool, provider, key, p, {
    target,
    expectedHash: hostedPlanHash(p),
    confirm: true,
    paused: true,
    ...extra,
  });
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_hosted_bootstrap_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people CASCADE");
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4)",
    [person, subject, "Synthetic creator", "bootstrap_fixture"],
  );
  await pool.query(
    "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '1 day')",
    [
      sessionHash,
      person,
      randomToken(),
      encrypt(
        {
          access_token: "synthetic",
          refresh_token: "synthetic",
          expires_in: 7200,
        },
        key,
      ),
    ],
  );
  plan = await prepare();
});
afterAll(async () => {
  await pool.end();
  await admin.end();
});
it("operator identity is required; production database role cannot read permits or exercise the exception", async () => {
  const role = "cv_bootstrap_test_" + randomUUID().replaceAll("-", ""),
    password = randomToken();
  await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  const runtimeUrl = new URL(url);
  runtimeUrl.username = role;
  runtimeUrl.password = password;
  const runtime = createPool(runtimeUrl.toString());
  try {
    await pool.query(
      `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; REVOKE ALL ON hosted_test_bootstrap FROM ${role}`,
    );
    await expect(
      runtime.query("SELECT * FROM hosted_test_bootstrap"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      prepareHostedPlan(runtime, provider, key, {
        target,
        login: "bootstrap_fixture",
        name: "Unauthorized",
        seed: "fern",
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");
    await expect(
      runtime.query(
        "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,origin) VALUES($1,$2,$3,'no-permit',$4,'Unauthorized','fern','development','pending','hosted-bootstrap')",
        [randomUUID(), person, randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await runtime.end();
    await pool.query(`DROP OWNED BY ${role}`);
    await pool.query(`DROP ROLE ${role}`);
  }
});
it("hosted prepare is identity-bound and creates no permit/job/world; tampering and missing approval fail", async () => {
  expect(
    (await pool.query("SELECT count(*)::int n FROM hosted_test_bootstrap"))
      .rows[0].n,
  ).toBe(0);
  await expect(apply(plan, { confirm: false })).rejects.toThrow(
    "PLAN_APPROVAL_REQUIRED",
  );
  await expect(apply(plan, { paused: false })).rejects.toThrow(
    "PLAN_APPROVAL_REQUIRED",
  );
  await expect(apply(plan, { target: hash("wrong") })).rejects.toThrow(
    "PLAN_APPROVAL_REQUIRED",
  );
  await expect(
    apply({ ...plan, seed: "changed" }, { expectedHash: hostedPlanHash(plan) }),
  ).rejects.toThrow("PLAN_APPROVAL_REQUIRED");
  await expect(
    apply({ ...plan, creatorSubjectHash: hash("wrong") }),
  ).rejects.toThrow("CREATOR_IDENTITY_CHANGED");
  await expect(
    apply({ ...plan, expiresAt: new Date(0).toISOString() }),
  ).rejects.toThrow("PLAN_EXPIRED");
  await expect(
    prepareHostedPlan(
      pool,
      {
        ...provider,
        validate: async () => {
          throw Error("provider unavailable");
        },
      },
      key,
      { target, login: "bootstrap_fixture", name: "No world", seed: "fern" },
    ),
  ).rejects.toThrow();
  expect(
    (await pool.query("SELECT count(*)::int n FROM founding_jobs")).rows[0].n,
  ).toBe(0);
});
it("normal development creation still requires v1; first bootstrap failure is safe and ordinary worker cannot resume it", async () => {
  await expect(
    pool.query(
      "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status) VALUES($1,$2,$3,'test',$4,'No predecessor','fern','development','pending')",
      [randomUUID(), person, randomUUID(), randomUUID()],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    applyHostedPlan(
      pool,
      provider,
      key,
      plan,
      {
        target,
        expectedHash: hostedPlanHash(plan),
        confirm: true,
        paused: true,
      },
      () => {
        throw Error("forced isolated failure");
      },
    ),
  ).rejects.toThrow("BOOTSTRAP_GENERATION_FAILED");
  expect(
    (await pool.query("SELECT count(*)::int n FROM worlds")).rows[0].n,
  ).toBe(0);
  expect(
    (await pool.query("SELECT count(*)::int n FROM founding_worlds")).rows[0].n,
  ).toBe(0);
  await pool.query(
    "UPDATE founding_jobs SET status='working',lease_until=now()-interval '1 second' WHERE id=$1",
    [plan.jobId],
  );
  const runner = foundingRunner(pool);
  await new Promise((r) => setTimeout(r, 300));
  await runner.close();
  expect(
    (
      await pool.query("SELECT status FROM founding_jobs WHERE id=$1", [
        plan.jobId,
      ])
    ).rows[0].status,
  ).toBe("working");
  await expect(
    pool.query("UPDATE founding_jobs SET origin='creator' WHERE id=$1", [
      plan.jobId,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("same-plan concurrent retry publishes once, idempotent receipt preserves geography and never enables membership", async () => {
  const results = await Promise.all([apply(), apply()]);
  expect(results.some((r) => r.status === "ready")).toBe(true);
  const state = (
    await pool.query(
      "SELECT id,creator_id,purpose,baseline_hash FROM founding_worlds",
    )
  ).rows;
  expect(state).toHaveLength(1);
  expect(state[0]).toMatchObject({
    id: plan.worldId,
    creator_id: person,
    purpose: "development",
  });
  expect(
    (await pool.query("SELECT count(*)::int n FROM worlds")).rows[0].n,
  ).toBe(0);
  expect(
    (await pool.query("SELECT count(*)::int n FROM wf2_bindings")).rows[0].n,
  ).toBe(0);
  expect(
    (await pool.query("SELECT count(*)::int n FROM wf2_contributions")).rows[0]
      .n,
  ).toBe(0);
  expect((await apply()).status).toBe("ready");
  expect(
    (
      await pool.query(
        "SELECT id,creator_id,purpose,baseline_hash FROM founding_worlds",
      )
    ).rows,
  ).toEqual(state);
  await expect(apply({ ...plan, worldId: randomUUID() })).rejects.toThrow(
    "BOOTSTRAP_ALREADY_RESERVED",
  );
  const b = generateBaseline("fern");
  expect(state[0].baseline_hash).toBe(b.hash);
});
it("different plans cannot race two worlds; operator recovery keeps one identity and stops at three attempts", async () => {
  await pool.query(
    "TRUNCATE hosted_test_bootstrap,founding_jobs,founding_worlds CASCADE",
  );
  const a = await prepare(),
    b = await prepare();
  const fail = () => {
    throw Error("isolated forced generation failure");
  };
  const options = (p: HostedPlan) => ({
    target,
    expectedHash: hostedPlanHash(p),
    confirm: true,
    paused: true,
  });
  const results = await Promise.allSettled([
    applyHostedPlan(pool, provider, key, a, options(a), fail),
    applyHostedPlan(pool, provider, key, b, options(b), fail),
  ]);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
  const reserved = (
    await pool.query("SELECT plan_hash,attempts FROM hosted_test_bootstrap")
  ).rows;
  expect(reserved).toHaveLength(1);
  const winner = reserved[0].plan_hash === hostedPlanHash(a) ? a : b;
  for (let i = 0; i < 2; i++)
    await expect(
      applyHostedPlan(pool, provider, key, winner, options(winner), fail),
    ).rejects.toThrow("BOOTSTRAP_GENERATION_FAILED");
  await expect(
    applyHostedPlan(pool, provider, key, winner, options(winner)),
  ).rejects.toThrow("BOOTSTRAP_RETRY_LIMIT");
  expect(
    (await pool.query("SELECT count(*)::int n FROM founding_jobs")).rows[0].n,
  ).toBe(1);
  expect(
    (await pool.query("SELECT count(*)::int n FROM founding_worlds")).rows[0].n,
  ).toBe(0);
  expect(
    (await pool.query("SELECT attempts FROM hosted_test_bootstrap")).rows[0]
      .attempts,
  ).toBe(3);
});
it("fresh bootstrap rejects occupied catalogs and expired real-identity sessions", async () => {
  await pool.query("DELETE FROM hosted_test_bootstrap");
  await expect(apply(await prepare())).rejects.toThrow(
    "FRESH_HOSTED_DATABASE_REQUIRED",
  );
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE session_hash=$1",
    [sessionHash],
  );
  await expect(prepare()).rejects.toThrow("REAL_CREATOR_SESSION_REQUIRED");
});
