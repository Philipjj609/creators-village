import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import { readLivingVillage } from "../apps/server/src/living.js";
import { bootstrap } from "../apps/server/src/participation-core.js";
import { replay } from "../apps/server/src/participation-events.js";
import { evaluateResidents } from "../packages/world/src/living.js";
import { renderDelta } from "../packages/renderer/src/reconcile.js";
import { snappedSite } from "../apps/web/src/placement-state.js";
import {
  DEMO_WORLD,
  demoConfig,
  demoProvider,
  seedDemoBase,
  initialiseDemo,
  demoHeaders,
  demoCommand,
} from "../scripts/f1-demo-fixture.mjs";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.port !== "55439")
  throw Error("F1 tests require isolated PG55439");
const admin = createPool(url.toString());
url.pathname = "/creators_village_f1_test";
const pool = createPool(url.toString());
const origin = "http://127.0.0.4:3009";
let fixture: any, app: Awaited<ReturnType<typeof buildApp>>;
const actor = (role: string) => ({
  person_id: fixture.actors[role].id,
  session_hash: fixture.actors[role].sessionHash,
});
const check = (site: object, role = "owner", headers = {}) =>
  app.inject({
    method: "POST",
    url: `/api/wf2/worlds/${DEMO_WORLD}/placement-check`,
    headers: { ...demoHeaders(fixture, role, origin), ...headers },
    payload: { site },
  });
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_f1_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people,wf2_operational_logs CASCADE");
  fixture = await seedDemoBase(pool);
  app = await buildApp(
    demoConfig(url.toString(), origin),
    pool,
    demoProvider(fixture),
  );
  await initialiseDemo(app, pool, fixture);
}, 30000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
it("checks snapped sites with the real creator authority and validator without reserving or saving anything", async () => {
  const signature = async () =>
    JSON.stringify(
      (
        await pool.query(
          "SELECT public_cursor,topology_epoch,(SELECT count(*) FROM wf2_projects) projects,(SELECT count(*) FROM wf2_claims) claims,(SELECT count(*) FROM wf2_command_receipts) receipts FROM founding_worlds WHERE id=$1",
          [DEMO_WORLD],
        )
      ).rows,
    );
  const before = await signature();
  const result = await check({ qx: -1792, qy: -1792 });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json()).toMatchObject({
    version: "cv-placement-1",
    valid: true,
    site: { qx: -1792, qy: -1792, widthQ: 1536, depthQ: 1536 },
  });
  expect((await check({ qx: 0, qy: 0 })).json()).toMatchObject({
    valid: false,
  });
  expect(await signature()).toBe(before);
  expect((await check({ qx: -1792, qy: -1792 }, "member")).statusCode).toBe(
    403,
  );
  expect((await check({ qx: -1792, qy: -1792 }, "outsider")).statusCode).toBe(
    404,
  );
  expect(
    (
      await check({ qx: -1792, qy: -1792 }, "owner", {
        "x-csrf-token": "wrong",
      })
    ).statusCode,
  ).toBe(403);
  expect((await check({ qx: 1, qy: 0 })).statusCode).toBe(400);
  expect(
    (await check({ qx: 128, qy: 0, template: "unsupported" })).statusCode,
  ).toBe(400);
  expect(snappedSite(-7.26, 2.24)).toEqual({ qx: -1920, qy: 512 });
});
it("reconstructs fictional site visits on reachable cells, never treating a project as a workplace", async () => {
  const plan = (await readLivingVillage(
    pool,
    DEMO_WORLD,
    fixture.actors.member.id,
  ))!;
  expect(plan.rules).toBe("cv-f2-goals-1");
  expect(plan.residents).toHaveLength(4);
  const visits = plan.residents.flatMap((r) =>
    r.goals!.filter((g) => g.label === "Checking the construction site"),
  );
  expect(visits.length).toBeGreaterThan(0);
  expect(visits.every((g) => g.structureId === null)).toBe(true);
  const reserved = new Set(
    (
      await pool.query(
        "SELECT hx,hy FROM wf2_claims WHERE world_id=$1 AND kind='reserved'",
        [DEMO_WORLD],
      )
    ).rows.map((r) => `${r.hx},${r.hy}`),
  );
  for (const r of plan.residents)
    for (const route of r.routes!)
      for (const p of route.points)
        expect(
          reserved.has(`${Math.floor(p.x * 2)},${Math.floor(p.y * 2)}`),
        ).toBe(false);
  const fixed = Date.UTC(2026, 10, 2, 11);
  expect(evaluateResidents(plan, fixed)).toEqual(
    evaluateResidents(JSON.parse(JSON.stringify(plan)), fixed),
  );
  expect(
    await readLivingVillage(pool, DEMO_WORLD, fixture.actors.outsider.id),
  ).toBeNull();
});
it("completes through the real worker, replays committed milestones and retains geometry after a fresh application instance", async () => {
  const before = await bootstrap(pool, actor("member"), DEMO_WORLD),
    p = before.projects.find((p) => p.id === fixture.projects.active)!;
  // Model a road predating this already-published reservation (legacy AP4 contract).
  await pool.query(
    "INSERT INTO founding_paths(world_id,id,width,geometry) VALUES($1,$2,384,$3)",
    [
      DEMO_WORLD,
      "f2-legacy-road",
      JSON.stringify([
        { qx: p.site.qx - 768, qy: p.site.qy },
        { qx: p.site.qx + 768, qy: p.site.qy },
      ]),
    ],
  );
  const id = randomUUID(),
    payload = {
      projectId: p.id,
      planHash: p.planHash,
      recognitionOptIn: false,
    };
  await Promise.all([
    demoCommand(app, fixture, "member", "Contribute", payload, id),
    demoCommand(app, fixture, "member", "Contribute", payload, id),
  ]);
  let next = before;
  for (let n = 0; n < 100; n++) {
    next = await bootstrap(pool, actor("member"), DEMO_WORLD);
    if (next.projects.find((v) => v.id === p.id)!.state === "completed") break;
    await new Promise((r) => setTimeout(r, 25));
  }
  await pool.query("DELETE FROM founding_paths WHERE world_id=$1 AND id=$2", [
    DEMO_WORLD,
    "f2-legacy-road",
  ]);
  next = await bootstrap(pool, actor("member"), DEMO_WORLD);
  expect(next.projects.find((v) => v.id === p.id)).toMatchObject({
    state: "completed",
    acceptedCount: 2,
  });
  expect(
    next.structures.filter((s) => s.id === "wf2-workshop-" + p.id),
  ).toHaveLength(1);
  expect(renderDelta(before, next)).toMatchObject({ pathsChanged: true });
  expect(renderDelta(before, next).newlyCompleted.map((v) => v.id)).toEqual([
    p.id,
  ]);
  const recovered = await replay(
    pool,
    actor("member"),
    DEMO_WORLD,
    before.cursor,
    100,
  );
  expect(JSON.stringify(recovered)).toContain("ConstructionCompleted");
  const snapshot = JSON.stringify(next);
  await app.close();
  app = await buildApp(
    demoConfig(url.toString(), origin),
    pool,
    demoProvider(fixture),
  );
  expect(
    JSON.stringify(await bootstrap(pool, actor("member"), DEMO_WORLD)),
  ).toBe(snapshot);
  const plan = (await readLivingVillage(
    pool,
    DEMO_WORLD,
    fixture.actors.member.id,
  ))!;
  const structures = new Set(next.structures.map((v) => v.id));
  expect(
    plan.residents
      .flatMap((r) => r.goals!.filter((g) => g.activity === "work"))
      .every((g) => !g.structureId || structures.has(g.structureId)),
  ).toBe(true);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_completion_results WHERE project_id=$1",
        [p.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("protects a saved connecting road during site checking and authoritative draft creation", async () => {
  const site = { qx: 0, qy: -2048 };
  // Genuine persisted path geometry in this disposable fixture, not decorative grass or props.
  const pathId = "f2-test-saved-road";
  expect((await check(site)).json().valid).toBe(true);
  const saved = (
    await demoCommand(app, fixture, "owner", "CreateDraft", { site })
  ).result;
  await pool.query(
    "INSERT INTO founding_paths(world_id,id,width,geometry) VALUES($1,$2,384,$3)",
    [
      DEMO_WORLD,
      pathId,
      JSON.stringify([
        { qx: -768, qy: -2048 },
        { qx: 768, qy: -2048 },
      ]),
    ],
  );
  try {
    expect((await check(site)).json().valid).toBe(false);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/wf2/worlds/${DEMO_WORLD}/commands`,
      headers: demoHeaders(fixture, "owner", origin),
      payload: {
        commandSchema: "wf2-command-1",
        commandId: randomUUID(),
        kind: "CreateDraft",
        payload: { site },
      },
    });
    expect(rejected.statusCode).toBe(400);
    const publish = await app.inject({
      method: "POST",
      url: `/api/wf2/worlds/${DEMO_WORLD}/commands`,
      headers: demoHeaders(fixture, "owner", origin),
      payload: {
        commandSchema: "wf2-command-1",
        commandId: randomUUID(),
        kind: "PublishProject",
        payload: {
          projectId: saved.projectId,
          expectedProjectRevision: "1",
          planHash: saved.planHash,
        },
      },
    });
    expect(publish.statusCode).toBe(400);
  } finally {
    await pool.query("DELETE FROM founding_paths WHERE world_id=$1 AND id=$2", [
      DEMO_WORLD,
      pathId,
    ]);
  }
});
it("rechecks a previously approved site when saving/publishing, hides drafts and avoids ground rebuilds for progress alone", async () => {
  const draft = (
    await demoCommand(app, fixture, "owner", "CreateDraft", {
      site: { qx: -1792, qy: -1792 },
    })
  ).result;
  expect(
    (await bootstrap(pool, actor("member"), DEMO_WORLD)).projects.some(
      (p) => p.id === draft.projectId,
    ),
  ).toBe(false);
  await demoCommand(app, fixture, "owner", "PublishProject", {
    projectId: draft.projectId,
    expectedProjectRevision: "1",
    planHash: draft.planHash,
  });
  expect((await check({ qx: -1792, qy: -1792 })).json()).toMatchObject({
    valid: false,
  });
  const rejected = await app.inject({
    method: "POST",
    url: `/api/wf2/worlds/${DEMO_WORLD}/commands`,
    headers: demoHeaders(fixture, "owner", origin),
    payload: {
      commandSchema: "wf2-command-1",
      commandId: randomUUID(),
      kind: "CreateDraft",
      payload: { site: { qx: -1792, qy: -1792 } },
    },
  });
  expect(rejected.statusCode).toBe(400);
  const before = await bootstrap(pool, actor("owner"), DEMO_WORLD),
    id = randomUUID();
  const same = await Promise.all([
    demoCommand(
      app,
      fixture,
      "owner",
      "Contribute",
      {
        projectId: draft.projectId,
        planHash: draft.planHash,
        recognitionOptIn: false,
      },
      id,
    ),
    demoCommand(
      app,
      fixture,
      "owner",
      "Contribute",
      {
        projectId: draft.projectId,
        planHash: draft.planHash,
        recognitionOptIn: false,
      },
      id,
    ),
  ]);
  expect(same[0]).toEqual(same[1]);
  const after = await bootstrap(pool, actor("owner"), DEMO_WORLD);
  expect(
    after.projects.find((p) => p.id === draft.projectId)!.acceptedCount,
  ).toBe(1);
  expect(renderDelta(before, after).pathsChanged).toBe(false);
  expect(renderDelta(before, after).newlyCompleted).toEqual([]);
  const duplicate = await app.inject({
    method: "POST",
    url: `/api/wf2/worlds/${DEMO_WORLD}/commands`,
    headers: demoHeaders(fixture, "owner", origin),
    payload: {
      commandSchema: "wf2-command-1",
      commandId: randomUUID(),
      kind: "Contribute",
      payload: {
        projectId: draft.projectId,
        planHash: draft.planHash,
        recognitionOptIn: false,
      },
    },
  });
  expect(duplicate.statusCode).toBe(409);
});

it("keeps initial resident bodies distinct and reconstructs the same reachable activity plan", async () => {
  const plan = (await readLivingVillage(
    pool,
    DEMO_WORLD,
    fixture.actors.member.id,
  ))!;
  const reconstructed = JSON.parse(JSON.stringify(plan));
  const start = Date.UTC(2026, 0, 1) + 240000 * 1000;
  for (const t of [
    start,
    start + 1000,
    start + 15000,
    start + 70000,
    start + 170000,
  ])
    expect(evaluateResidents(plan, t)).toEqual(
      evaluateResidents(reconstructed, t),
    );
  const positions = evaluateResidents(plan, start).map((r) => r.position);
  expect(new Set(positions.map((p) => p.x + "," + p.y)).size).toBe(4);
  for (const r of plan.residents) {
    const work = r.goals?.find((g) => g.activity === "work");
    if (work) {
      const row = (
        await pool.query(
          "SELECT entrance_qy FROM founding_structures WHERE world_id=$1 AND id=$2",
          [DEMO_WORLD, work.structureId],
        )
      ).rows[0];
      expect(work.position.y).toBeGreaterThan(row.entrance_qy / 256);
    }
  }
});
