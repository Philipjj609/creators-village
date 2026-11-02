import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import { accrueOrbs, ORB_POLICY } from "../packages/contracts/src/orbs.js";
import { connectRoad } from "../apps/server/src/orb-path.js";
import { wallet as readWallet } from "../apps/server/src/orb-storage.js";
import { transaction } from "../apps/server/src/participation-core.js";
import {
  DEMO_WORLD,
  seedDemoBase,
  initialiseDemo,
  demoConfig,
  demoProvider,
  demoHeaders,
  demoCommand,
} from "../scripts/f1-demo-fixture.mjs";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.port !== "55439")
  throw Error("Isolated PG55439 only");
const admin = createPool(url.toString());
url.pathname = "/creators_village_f3_test";
const pool = createPool(url.toString());
const origin = "http://127.0.0.4:3009",
  prefix = "/api/wf2/worlds/" + DEMO_WORLD;
let fixture: any,
  app: Awaited<ReturnType<typeof buildApp>>,
  project: any,
  legacy: string;
const req = (role: string, path: string, body?: unknown) =>
  app.inject({
    method: body === undefined ? "POST" : "POST",
    url: prefix + path,
    headers: demoHeaders(fixture, role, origin),
    ...(body === undefined ? {} : { payload: body }),
  });
const pulse = (role = "owner") => req(role, "/orbs/heartbeat");
const fund = (role: string, amount: number, id = randomUUID()) =>
  req(role, "/orbs/fund", {
    commandId: id,
    projectId: project.projectId,
    planHash: project.planHash,
    amount,
  });
const state = async () => {
  const r = await app.inject({
    url: prefix + "/bootstrap",
    headers: demoHeaders(fixture, "owner", origin),
  });
  return r.json();
};
async function plan(x: number, y: number) {
  let d = await req("owner", "/orbs/drafts", {
    commandId: randomUUID(),
    commandSchema: "f3-command-1",
    kind: "CreateDraft",
    payload: { site: { qx: x * 256, qy: y * 256 } },
  });
  expect(d.statusCode, d.body).toBe(200);
  const p = d.json().result;
  await demoCommand(app, fixture, "owner", "PublishProject", {
    projectId: p.projectId,
    expectedProjectRevision: p.projectRevision,
    planHash: p.planHash,
  });
  return p;
}
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_f3_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people,wf2_operational_logs CASCADE");
  fixture = await seedDemoBase(pool);
  const initialConfig = {
    ...demoConfig(url.toString(), origin),
    orbEconomy: false,
  };
  app = await buildApp(initialConfig, pool, demoProvider(fixture));
  await initialiseDemo(app, pool, fixture);
  initialConfig.orbEconomy = true;
  await demoCommand(app, fixture, "member", "Contribute", {
    projectId: fixture.projects.active,
    planHash: (await state()).projects.find(
      (p: any) => p.id === fixture.projects.active,
    ).planHash,
    recognitionOptIn: false,
  });
  for (
    let i = 0;
    i < 100 && (await state()).projects.some((p: any) => p.state === "ready");
    i++
  )
    await new Promise((r) => setTimeout(r, 25));
  legacy = JSON.stringify(
    (await pool.query("SELECT * FROM wf2_contributions ORDER BY id")).rows,
  );
}, 30000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
it("counts exact server intervals, bounds earnings and discards offline gaps without a background simulation", () => {
  expect(accrueOrbs(30, 299999, 0)).toEqual({ award: 0, remainder: 299999 });
  expect(accrueOrbs(30, 299999, 1)).toEqual({ award: 5, remainder: 0 });
  expect(accrueOrbs(118, 299999, 1)).toEqual({ award: 2, remainder: 0 });
  expect(accrueOrbs(120, 299999, 1)).toEqual({ award: 0, remainder: 0 });
  expect(accrueOrbs(30, 2000, 45001)).toEqual({ award: 0, remainder: 2000 });
  expect(accrueOrbs(30, 2000, -1)).toEqual({ award: 0, remainder: 2000 });
});
it("chooses a valid road route when the nearest road is disconnected, and stops at blocked ground", () => {
  const route = connectRoad(
    [
      { qx: 0, qy: 0 },
      { qx: 0, qy: 256 },
    ],
    { qx: 256, qy: 0 },
    (a, b) =>
      b.qx >= 0 &&
      b.qx <= 256 &&
      b.qy >= 0 &&
      b.qy <= 256 &&
      !(a.qx === 0 && a.qy === 0) &&
      !(b.qx === 128 && b.qy === 0),
  );
  expect(route?.[0]).toEqual({ qx: 0, qy: 256 });
  expect(route?.at(-1)).toEqual({ qx: 256, qy: 0 });
  expect(
    connectRoad([{ qx: 0, qy: 0 }], { qx: 256, qy: 0 }, () => false),
  ).toBeNull();
});
it("awards starting Orbs once, denies outsiders/CSRF and never leaks another wallet", async () => {
  const r = await Promise.all([pulse(), pulse(), pulse()]);
  expect(r.map((x) => x.statusCode)).toEqual([200, 200, 200]);
  expect(r.map((x) => x.json().balance)).toEqual([30, 30, 30]);
  expect((await pulse("member")).json().balance).toBe(30);
  expect((await pulse("outsider")).statusCode).toBe(404);
  const bad = await app.inject({
    method: "POST",
    url: prefix + "/orbs/heartbeat",
    headers: {
      ...demoHeaders(fixture, "owner", origin),
      "x-csrf-token": "wrong",
    },
  });
  expect(bad.statusCode).toBe(403);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM f3_orb_ledger WHERE kind='start'",
      )
    ).rows[0].n,
  ).toBe(2);
});
it("publishes a distinct 60-Orb plan; repeat funding is real, transactional and exactly once", async () => {
  project = await plan(-7, -7);
  const p = (await state()).projects.find(
    (p: any) => p.id === project.projectId,
  );
  expect(p).toMatchObject({
    fundingModel: ORB_POLICY.version,
    goal: 60,
    acceptedCount: 0,
    nonCreatorConditionMet: true,
  });
  const old = await app.inject({
    method: "POST",
    url: prefix + "/commands",
    headers: demoHeaders(fixture, "owner", origin),
    payload: {
      commandId: randomUUID(),
      commandSchema: "wf2-command-1",
      kind: "Contribute",
      payload: {
        projectId: project.projectId,
        planHash: project.planHash,
        recognitionOptIn: false,
      },
    },
  });
  expect(old.statusCode).toBe(400);
  const id = randomUUID(),
    both = await Promise.all([fund("owner", 5, id), fund("owner", 5, id)]);
  expect(both.map((x) => x.statusCode)).toEqual([200, 200]);
  expect(both[0].json()).toEqual(both[1].json());
  expect((await fund("owner", 5)).statusCode).toBe(200);
  expect((await pulse()).json().balance).toBe(20);
  const races = await Promise.all([fund("owner", 15), fund("owner", 15)]);
  expect(races.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  expect((await pulse()).json().balance).toBe(5);
  expect((await fund("owner", 6)).statusCode).toBe(409);
  expect((await fund("member", 30)).statusCode).toBe(200);
  expect((await fund("owner", 6)).statusCode).toBe(400);
  expect((await fund("owner", 5)).statusCode).toBe(200);
  for (let i = 0; i < 100; i++) {
    if (
      (await state()).projects.find((p: any) => p.id === project.projectId)
        .state === "completed"
    )
      break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const saved = await state();
  expect(
    saved.projects.find((p: any) => p.id === project.projectId),
  ).toMatchObject({ state: "completed", acceptedCount: 60 });
  expect(
    saved.structures.filter(
      (s: any) => s.id === "wf2-workshop-" + project.projectId,
    ),
  ).toHaveLength(1);
  const funded = saved.projects.find((p: any) => p.id === project.projectId);
  expect(funded.pathExtension.points).toHaveLength(2);
  expect(
    saved.paths.find(
      (p: any) => p.id === "wf2-path-" + project.projectId + "-frontage",
    ).points,
  ).toEqual(funded.pathExtension.points);
  const snapshot = JSON.stringify(saved);
  await app.close();
  app = await buildApp(
    { ...demoConfig(url.toString(), origin), orbEconomy: true },
    pool,
    demoProvider(fixture),
  );
  expect(JSON.stringify(await state())).toBe(snapshot);
  expect((await fund("owner", 5, id)).statusCode).toBe(200);
  expect((await fund("owner", 4, id)).statusCode).toBe(409);
  expect((await pulse()).json().balance).toBe(0);
  expect((await pulse("member")).json().balance).toBe(0);
  expect(
    JSON.stringify(
      (await pool.query("SELECT * FROM wf2_contributions ORDER BY id")).rows,
    ),
  ).toBe(legacy);
});
it("keeps amounts auditable and identities private until explicit consent, including withdrawal", async () => {
  const history = async () => {
    const r = await app.inject({
      url: prefix + "/orbs/projects/" + project.projectId + "/history",
      headers: demoHeaders(fixture, "member", origin),
    });
    expect(r.statusCode).toBe(200);
    return r.json().contributions;
  };
  let rows = await history();
  expect(rows.reduce((a: number, r: any) => a + r.amount, 0)).toBe(60);
  expect(rows.every((r: any) => r.name === null || r.name === "You")).toBe(
    true,
  );
  expect(JSON.stringify(rows)).not.toContain(fixture.actors.owner.id);
  await demoCommand(app, fixture, "owner", "SetRecognition", {
    projectId: project.projectId,
    optedIn: true,
  });
  rows = await history();
  expect(rows.some((r: any) => r.name === "Demo Creator")).toBe(true);
  const r = await app.inject({
    method: "POST",
    url: "/api/wf2/privacy/commands",
    headers: demoHeaders(fixture, "owner", origin),
    payload: {
      commandId: randomUUID(),
      commandSchema: "wf2-command-1",
      kind: "SetRecognition",
      payload: { projectId: project.projectId, optedIn: false },
    },
  });
  expect(r.statusCode, r.body).toBe(200);
  expect((await history()).some((r: any) => r.name === "Demo Creator")).toBe(
    false,
  );
});
it("accrues once at a persisted boundary and refunds a cancelled project once without erasing history", async () => {
  await pool.query(
    "UPDATE f3_orb_wallets SET remainder_ms=299999,last_seen=clock_timestamp()-interval '1 second' WHERE person_id=$1",
    [fixture.actors.owner.id],
  );
  const pulses = await Promise.all([pulse(), pulse(), pulse()]);
  expect(pulses.every((r) => r.json().balance === 5)).toBe(true);
  project = await plan(7, -7);
  expect((await fund("owner", 5)).statusCode).toBe(200);
  let p = (await state()).projects.find((p: any) => p.id === project.projectId);
  const cmd = {
    commandId: randomUUID(),
    commandSchema: "wf2-command-1",
    kind: "CancelProject",
    payload: { projectId: p.id, expectedProjectRevision: p.revision },
  };
  const a = await req("owner", "/commands", cmd),
    b = await req("owner", "/commands", cmd);
  expect(a.statusCode).toBe(200);
  expect(b.statusCode).toBe(200);
  expect((await pulse()).json().balance).toBe(5);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM f3_orb_ledger WHERE kind='refund'",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT sum(amount)::int n FROM f3_orb_contributions WHERE project_id=$1",
        [p.id],
      )
    ).rows[0].n,
  ).toBe(5);
});

it("keeps creator-community balances separate, records every award, and stops accrual at the cap", async () => {
  const binding = (
    await pool.query(
      "SELECT community_id FROM wf2_bindings WHERE world_id=$1",
      [DEMO_WORLD],
    )
  ).rows[0].community_id;
  const community = randomUUID();
  await pool.query("INSERT INTO wf2_communities(id,creator_id) VALUES($1,$2)", [
    community,
    fixture.actors.outsider.id,
  ]);
  await pool.query(
    "INSERT INTO wf2_memberships(id,community_id,person_id,state) VALUES($1,$2,$3,'active')",
    [randomUUID(), community, fixture.actors.owner.id],
  );
  const another = await transaction(pool, (db) =>
    readWallet(db, community, fixture.actors.owner.id),
  );
  expect(another.balance).toBe(30);
  for (let i = 0; i < 23; i++) {
    await pool.query(
      "UPDATE f3_orb_wallets SET remainder_ms=299999,last_seen=clock_timestamp()-interval '1 second' WHERE person_id=$1 AND community_id<>$2",
      [fixture.actors.owner.id, community],
    );
    await transaction(pool, (db) =>
      readWallet(db, binding, fixture.actors.owner.id),
    );
  }
  expect((await pulse()).json().balance).toBe(120);
  const audit = (
    await pool.query(
      "SELECT w.balance,coalesce(sum(l.amount),0)::int AS total FROM f3_orb_wallets w JOIN f3_orb_ledger l USING(community_id,person_id) GROUP BY w.community_id,w.person_id,w.balance",
    )
  ).rows;
  expect(audit.every((r: any) => r.balance === r.total)).toBe(true);
  expect(
    (
      await pool.query(
        "SELECT balance FROM f3_orb_wallets WHERE community_id=$1 AND person_id=$2",
        [community, fixture.actors.owner.id],
      )
    ).rows[0].balance,
  ).toBe(30);
});

it("retains private receipts and withdrawal after leaving, and denies further accrual or funding", async () => {
  const oldProject = (
    await pool.query(
      "SELECT project_id FROM f3_orb_contributions WHERE person_id=$1 LIMIT 1",
      [fixture.actors.member.id],
    )
  ).rows[0].project_id;
  await demoCommand(app, fixture, "member", "LeaveCommunity", {});
  expect((await pulse("member")).statusCode).toBe(404);
  const withdrawal = await app.inject({
    method: "POST",
    url: "/api/wf2/privacy/commands",
    headers: demoHeaders(fixture, "member", origin),
    payload: {
      commandId: randomUUID(),
      commandSchema: "wf2-command-1",
      kind: "SetRecognition",
      payload: { projectId: oldProject, optedIn: false },
    },
  });
  expect(withdrawal.statusCode, withdrawal.body).toBe(200);
  const own = await app.inject({
    url: "/api/wf2/me",
    headers: demoHeaders(fixture, "member", origin),
  });
  expect(own.statusCode).toBe(200);
  expect(own.json().receipts.some((r: any) => r.projectId === oldProject)).toBe(
    true,
  );
});

it("requires Orb funding for new drafts after activation while replaying historical draft receipts unchanged", async () => {
  const newDraft = {
    commandId: randomUUID(),
    commandSchema: "wf2-command-1",
    kind: "CreateDraft",
    payload: { site: { qx: 0, qy: -2048 } },
  };
  expect((await req("owner", "/commands", newDraft)).statusCode).toBe(409);
  const prior = (
    await pool.query(
      "SELECT command_id,result FROM wf2_command_receipts WHERE person_id=$1 AND kind='CreateDraft' AND command_schema='wf2-command-1' ORDER BY created_at LIMIT 1",
      [fixture.actors.owner.id],
    )
  ).rows[0];
  const p = (
    await pool.query("SELECT qx,qy FROM wf2_projects WHERE id=$1", [
      prior.result.projectId,
    ])
  ).rows[0];
  const retry = await req("owner", "/commands", {
    ...newDraft,
    commandId: prior.command_id,
    payload: { site: { qx: p.qx, qy: p.qy } },
  });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().result).toEqual(prior.result);
});

it("does not turn view access into spending or creator placement authority", async () => {
  const draft = {
    commandId: randomUUID(),
    commandSchema: "f3-command-1",
    kind: "CreateDraft",
    payload: { site: { qx: 0, qy: -2048 } },
  };
  expect((await req("member", "/orbs/drafts", draft)).statusCode).toBe(404); // member has left; no private world disclosure
  expect((await req("outsider", "/orbs/drafts", draft)).statusCode).toBe(404);
  const invalid = await req("owner", "/orbs/fund", {
    commandId: randomUUID(),
    projectId: project.projectId,
    planHash: project.planHash,
    amount: 0,
  });
  expect(invalid.statusCode).toBe(400);
  const binding = (
    await pool.query(
      "SELECT community_id FROM wf2_bindings WHERE world_id=$1",
      [DEMO_WORLD],
    )
  ).rows[0].community_id;
  await pool.query(
    "UPDATE wf2_memberships SET state='active' WHERE community_id=$1 AND person_id=$2",
    [binding, fixture.actors.member.id],
  );
  await pool.query(
    "UPDATE wf2_world_grants SET can_view=true,can_contribute=false,revoked_at=null WHERE world_id=$1 AND person_id=$2",
    [DEMO_WORLD, fixture.actors.member.id],
  );
  expect((await pulse("member")).statusCode).toBe(403);
  expect((await req("member", "/orbs/drafts", draft)).statusCode).toBe(403);
  expect((await fund("member", 1)).statusCode).toBe(403);
});

it("persists the economy boundary when a runtime feature toggle is off", async () => {
  await app.close();
  app = await buildApp(
    { ...demoConfig(url.toString(), origin), orbEconomy: false },
    pool,
    demoProvider(fixture),
  );
  const r = await req("owner", "/commands", {
    commandId: randomUUID(),
    commandSchema: "wf2-command-1",
    kind: "CreateDraft",
    payload: { site: { qx: 0, qy: -2048 } },
  });
  expect(r.statusCode).toBe(409);
  expect(r.json().error.code).toBe("FUNDING_VERSION_REQUIRED");
  const s = await state();
  expect(
    s.projects.some((p: any) => p.fundingModel === "community-orbs-1"),
  ).toBe(true);
});
