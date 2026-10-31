// Operator CLI service only. Intentionally not imported by the HTTP application.
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./database.js";
import {
  FOUNDING_GENERATOR,
  FOUNDING_PROFILE,
} from "@creators-village/contracts";
import { generateBaseline } from "@creators-village/world/founding";
import { publishFounding } from "./founding.js";
import { hash } from "./security.js";
import { validateSessionHash } from "./session-validation.js";
import type { TwitchGateway } from "./twitch.js";
export type HostedPlan = {
  releaseHash: string;
  policy: "hosted-test-bootstrap-1";
  purpose: "hosted-integration-test";
  target: string;
  operatorRole: string;
  creatorPersonId: string;
  creatorSubjectHash: string;
  creatorLogin: string;
  worldId: string;
  jobId: string;
  commandId: string;
  name: string;
  seed: string;
  generator: typeof FOUNDING_GENERATOR;
  profile: typeof FOUNDING_PROFILE;
  asset: "hearthside-hero-01";
  expiresAt: string;
};
const keys = [
  "releaseHash",
  "policy",
  "purpose",
  "target",
  "operatorRole",
  "creatorPersonId",
  "creatorSubjectHash",
  "creatorLogin",
  "worldId",
  "jobId",
  "commandId",
  "name",
  "seed",
  "generator",
  "profile",
  "asset",
  "expiresAt",
] as const;
export function hostedPlanHash(input: HostedPlan) {
  if (
    !input ||
    Object.keys(input).length !== keys.length ||
    keys.some((k) => typeof input[k] !== "string")
  )
    throw Error("INVALID_PLAN");
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  if (
    input.policy !== "hosted-test-bootstrap-1" ||
    input.purpose !== "hosted-integration-test" ||
    input.generator !== FOUNDING_GENERATOR ||
    input.profile !== FOUNDING_PROFILE ||
    input.asset !== "hearthside-hero-01" ||
    !/^[a-z0-9_]{1,25}$/.test(input.creatorLogin) ||
    !/^[0-9a-f]{64}$/.test(input.target) ||
    !/^[0-9a-f]{64}$/.test(input.releaseHash) ||
    !/^[0-9a-f]{64}$/.test(input.creatorSubjectHash) ||
    ![input.creatorPersonId, input.worldId, input.jobId, input.commandId].every(
      (v) => uuid.test(v),
    ) ||
    !input.operatorRole ||
    input.name.trim() !== input.name ||
    input.name.length < 3 ||
    input.name.length > 60 ||
    !input.seed ||
    input.seed.length > 64 ||
    !Number.isFinite(Date.parse(input.expiresAt))
  )
    throw Error("INVALID_PLAN");
  return hash(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, input[k]]))),
  );
}
async function operator(pool: Pool) {
  const r = (
    await pool.query(
      "SELECT current_user AS role,session_user AS login,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.founding_jobs'::regclass",
    )
  ).rows[0];
  if (!r || r.role !== r.login || r.role !== r.owner || r.role === "cv_runtime")
    throw Error("OPERATOR_REQUIRED");
  return r.role as string;
}
async function releaseHash() {
  const files = [
    "apps/server/dist/runtime-manifest.json",
    "release-manifest.json",
    "docs/testing/evidence/wf2/source-calibration.json",
  ];
  return hash(
    JSON.stringify(
      await Promise.all(
        files.map(async (file) =>
          hash(await fs.readFile(path.join(repositoryRoot, file), "utf8")),
        ),
      ),
    ),
  );
}
async function identity(
  pool: Pool,
  provider: TwitchGateway,
  key: string,
  login: string,
) {
  const r = (
    await pool.query(
      "SELECT p.id,p.twitch_subject,s.session_hash FROM people p JOIN sessions s ON s.person_id=p.id WHERE p.twitch_login=$1 AND s.expires_at>now() ORDER BY s.validated_at DESC LIMIT 1",
      [login],
    )
  ).rows[0];
  if (!r) throw Error("REAL_CREATOR_SESSION_REQUIRED");
  const verified = await validateSessionHash(
    pool,
    provider,
    key,
    r.session_hash,
    true,
  );
  const p = (
    await pool.query(
      "SELECT twitch_subject,twitch_login FROM people WHERE id=$1",
      [r.id],
    )
  ).rows[0];
  if (
    !verified ||
    !p ||
    p.twitch_login !== login ||
    verified.person_id !== r.id ||
    verified.twitch_subject !== p.twitch_subject
  )
    throw Error("CREATOR_IDENTITY_CHANGED");
  return {
    person: r.id as string,
    subjectHash: hash(p.twitch_subject),
    sessionHash: r.session_hash as string,
  };
}
export async function prepareHostedPlan(
  pool: Pool,
  provider: TwitchGateway,
  key: string,
  input: { target: string; login: string; name: string; seed: string },
): Promise<HostedPlan> {
  const role = await operator(pool),
    who = await identity(pool, provider, key, input.login);
  const plan: HostedPlan = {
    releaseHash: await releaseHash(),
    policy: "hosted-test-bootstrap-1",
    purpose: "hosted-integration-test",
    target: input.target,
    operatorRole: role,
    creatorPersonId: who.person,
    creatorSubjectHash: who.subjectHash,
    creatorLogin: input.login,
    worldId: randomUUID(),
    jobId: randomUUID(),
    commandId: randomUUID(),
    name: input.name.trim(),
    seed: input.seed.normalize("NFC"),
    generator: FOUNDING_GENERATOR,
    profile: FOUNDING_PROFILE,
    asset: "hearthside-hero-01",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  hostedPlanHash(plan);
  return plan;
}
export async function applyHostedPlan(
  pool: Pool,
  provider: TwitchGateway,
  key: string,
  plan: HostedPlan,
  options: {
    target: string;
    expectedHash: string;
    confirm: boolean;
    paused: boolean;
  },
  generate = generateBaseline,
) {
  const digest = hostedPlanHash(plan),
    role = await operator(pool);
  if (
    !options.confirm ||
    !options.paused ||
    options.target !== plan.target ||
    options.expectedHash !== digest ||
    role !== plan.operatorRole
  )
    throw Error("PLAN_APPROVAL_REQUIRED");
  if (plan.releaseHash !== (await releaseHash()))
    throw Error("PLAN_RELEASE_CHANGED");
  const who = await identity(pool, provider, key, plan.creatorLogin);
  if (
    who.person !== plan.creatorPersonId ||
    who.subjectHash !== plan.creatorSubjectHash
  )
    throw Error("CREATOR_IDENTITY_CHANGED");
  const db = await pool.connect();
  let lease: string | undefined;
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query("SET LOCAL transaction_timeout='10s'");
    await db.query("SELECT pg_advisory_xact_lock(10283026)");
    await db.query("SELECT id FROM people WHERE id=$1 FOR UPDATE", [
      who.person,
    ]);
    const session = await db.query(
      "SELECT session_hash FROM sessions WHERE session_hash=$1 AND person_id=$2 AND expires_at>now() AND validated_at>now()-interval '1 minute' FOR SHARE",
      [who.sessionHash, who.person],
    );
    if (!session.rowCount) throw Error("REAL_CREATOR_SESSION_REQUIRED");
    const prior = (
      await db.query(
        "SELECT b.*,j.status,j.lease_until,j.world_id AS job_world,j.creator_id AS job_creator,j.command_id AS job_command,j.name AS job_name,j.seed AS job_seed,j.origin AS job_origin FROM hosted_test_bootstrap b JOIN founding_jobs j ON j.id=b.job_id WHERE b.slot=1 FOR UPDATE OF b,j",
      )
    ).rows[0];
    if (
      prior &&
      (prior.plan_hash !== digest ||
        prior.world_id !== plan.worldId ||
        prior.creator_id !== who.person)
    )
      throw Error("BOOTSTRAP_ALREADY_RESERVED");
    if (
      prior &&
      (prior.job_world !== plan.worldId ||
        prior.job_creator !== who.person ||
        prior.job_command !== plan.commandId ||
        prior.job_name !== plan.name ||
        prior.job_seed !== plan.seed ||
        prior.job_origin !== "hosted-bootstrap")
    )
      throw Error("BOOTSTRAP_FACTS_CHANGED");
    if (prior?.status === "ready") {
      if (
        !(
          await db.query(
            "SELECT id FROM founding_worlds WHERE id=$1 AND creator_id=$2 AND job_id=$3 AND purpose='development'",
            [plan.worldId, who.person, plan.jobId],
          )
        ).rowCount
      )
        throw Error("BOOTSTRAP_FACTS_CHANGED");
      await db.query(
        "UPDATE hosted_test_bootstrap SET completed_at=COALESCE(completed_at,now()) WHERE slot=1",
      );
      await db.query("COMMIT");
      return { status: "ready" as const, planHash: digest };
    }
    if (
      Date.parse(plan.expiresAt) <= Date.now() ||
      Date.parse(plan.expiresAt) > Date.now() + 90000000
    )
      throw Error("PLAN_EXPIRED");
    if (
      prior?.status === "working" &&
      prior.lease_until &&
      prior.lease_until.getTime() > Date.now()
    ) {
      await db.query("COMMIT");
      return { status: "working" as const, planHash: digest };
    }
    if (prior && prior.attempts >= 3) throw Error("BOOTSTRAP_RETRY_LIMIT");
    if (!prior) {
      await db.query(
        "LOCK TABLE worlds,founding_jobs,founding_worlds,wf2_projects,wf2_contributions IN SHARE ROW EXCLUSIVE MODE",
      );
      const exists = (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM worlds) OR EXISTS(SELECT 1 FROM founding_jobs) OR EXISTS(SELECT 1 FROM founding_worlds) OR EXISTS(SELECT 1 FROM wf2_projects) OR EXISTS(SELECT 1 FROM wf2_contributions) AS occupied",
        )
      ).rows[0].occupied;
      if (exists) throw Error("FRESH_HOSTED_DATABASE_REQUIRED");
      const requestHash = hash(
        JSON.stringify({ name: plan.name, seed: plan.seed, development: true }),
      );
      await db.query(
        "INSERT INTO hosted_test_bootstrap(slot,policy,purpose,plan_hash,operator_role,creator_id,world_id,job_id,command_id,request_hash,world_name,seed,expires_at) VALUES(1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          plan.policy,
          plan.purpose,
          digest,
          role,
          who.person,
          plan.worldId,
          plan.jobId,
          plan.commandId,
          requestHash,
          plan.name,
          plan.seed,
          plan.expiresAt,
        ],
      );
      await db.query(
        "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,origin) VALUES($1,$2,$3,$4,$5,$6,$7,'development','pending','hosted-bootstrap')",
        [
          plan.jobId,
          who.person,
          plan.commandId,
          requestHash,
          plan.worldId,
          plan.name,
          plan.seed,
        ],
      );
    }
    lease = (
      await db.query(
        "UPDATE founding_jobs SET status='working',error=NULL,lease_until=date_trunc('milliseconds',now()+interval '30 seconds') WHERE id=$1 RETURNING lease_until",
        [plan.jobId],
      )
    ).rows[0].lease_until.toISOString();
    await db.query(
      "UPDATE hosted_test_bootstrap SET attempts=attempts+1 WHERE slot=1",
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  try {
    const baseline = generate(plan.seed);
    if (
      baseline.generator !== plan.generator ||
      baseline.profile !== plan.profile
    )
      throw Error("GENERATOR_CHANGED");
    await publishFounding(pool, plan.jobId, baseline, lease!);
  } catch {
    await pool.query(
      "UPDATE founding_jobs SET status='failed',error='Hosted bootstrap generation failed safely',lease_until=NULL WHERE id=$1 AND status='working' AND lease_until=$2",
      [plan.jobId, lease],
    );
    throw Error("BOOTSTRAP_GENERATION_FAILED");
  }
  const row = (
    await pool.query("SELECT status FROM founding_jobs WHERE id=$1", [
      plan.jobId,
    ])
  ).rows[0];
  if (row?.status === "ready")
    await pool.query(
      "UPDATE hosted_test_bootstrap SET completed_at=COALESCE(completed_at,now()) WHERE slot=1",
    );
  return {
    status: row?.status === "ready" ? ("ready" as const) : ("working" as const),
    planHash: digest,
  };
}
