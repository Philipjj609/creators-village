import { it, expect } from "vitest";
import type {
  Wf2State,
  Wf2Batch,
  Wf2Project,
} from "../packages/contracts/src/participation.js";
import { applyWf2Batch, readWf2State } from "../apps/web/src/wf2-state.js";
const initial = {
  stateSchema: "wf2-state-1",
  worldId: "00000000-0000-4000-8000-000000000001",
  baseline: {
    format: 2,
    generator: "commons-geography-1",
    profile: "gentle-512-32-2",
    seed: "wire-fixture",
    min: -256,
    size: 512,
    chunkSize: 32,
    heightUnits: 16,
    hash: "a".repeat(64),
    landform: "lake-edge",
    certificate: {
      version: 1,
      valid: true,
      opportunities: 8,
      expansionOpportunities: 2,
      exits: 2,
      repairs: [],
    },
  },
  active: { centerX: 0, centerY: 0, radius: 32, version: 1 },
  cursor: "1",
  topologyEpoch: "1",
  creditRevision: "1",
  replayFloor: "1",
  structures: [],
  paths: [],
  projects: [],
  currentChunkRevisions: Array.from({ length: 256 }, (_, i) => ({
    x: (i % 16) - 8,
    y: Math.floor(i / 16) - 8,
    revision: "1",
  })),
} as unknown as Wf2State;
const project = {
  id: "00000000-0000-4000-8000-000000000002",
  revision: "1",
  planRevision: "1",
  planHash: "a".repeat(64),
  state: "open",
  goal: 2,
  acceptedCount: 0,
  nonCreatorConditionMet: false,
  blockedCode: null,
  template: "wf2-workshop-1",
  site: {
    qx: 1792,
    qy: 1280,
    baseHeight: 16,
    widthQ: 1536,
    depthQ: 1536,
    entrance: { qx: 1792, qy: 2176 },
    appearance: "hearthside-hero-01/workshop",
    assetManifestHash: "b".repeat(64),
  },
  path: {
    widthQ: 384,
    points: [
      { qx: 0, qy: 2304 },
      { qx: 1792, qy: 2304 },
      { qx: 1792, qy: 2176 },
    ],
  },
} satisfies Wf2Project;
const batch = {
  batchSchema: "wf2-batch-1",
  worldId: initial.worldId,
  batchId: "00000000-0000-4000-8000-000000000003",
  fromCursor: "1",
  toCursor: "2",
  kind: "ProjectOpened",
  changes: [{ type: "project", value: project }],
  topologyEpoch: "2",
  creditRevision: "1",
  changedChunks: [{ x: 0, y: 0, revision: "2" }],
} satisfies Wf2Batch;
it("E05/E07: duplicates ignore, gaps/unknown schema/malformed payload reset without mutating current state", () => {
  expect(readWf2State(initial).worldId).toBe(initial.worldId);
  const s = applyWf2Batch(initial, batch);
  expect(s.projects).toHaveLength(1);
  expect(initial.projects).toHaveLength(0);
  expect(applyWf2Batch(s, batch)).toBe(s);
  for (const invalid of [
    { ...batch, fromCursor: "2", toCursor: "3" },
    { ...batch, batchSchema: "unknown" },
    {
      ...batch,
      changes: [{ type: "creditInvalidation", projectId: project.id }],
      kind: "UNKNOWN",
    },
    {
      ...batch,
      changes: [{ type: "project", value: { ...project, acceptedCount: 3 } }],
    },
  ])
    expect(() => applyWf2Batch(initial, invalid)).toThrow("RESET_REQUIRED");
  expect(() =>
    readWf2State({ ...initial, baseline: { hash: "changed" } }),
  ).toThrow();
  expect(() => readWf2State({ ...initial, stateSchema: "future" })).toThrow();
});
it("E05: partial completion is rejected atomically; one complete batch installs project, structure, path and cursor together", () => {
  const done: Wf2Batch = {
    ...batch,
    kind: "ConstructionCompleted",
    changes: [
      {
        type: "project",
        value: {
          ...project,
          state: "completed",
          acceptedCount: 2,
          nonCreatorConditionMet: true,
          revision: "3",
        },
      },
      {
        type: "structure",
        value: {
          id: "wf2-workshop-" + project.id,
          template: "wf2-workshop-1",
          position: { qx: 1024, qy: 512, height: 16 },
          footprint: { widthQ: 1536, depthQ: 1536 },
          entrance: { qx: 1792, qy: 2176 },
          appearance: project.site.appearance,
          assetManifestHash: project.site.assetManifestHash,
          revision: "1",
        },
      },
      {
        type: "path",
        value: {
          id: "wf2-path-" + project.id,
          widthQ: 384,
          points: project.path.points,
          revision: "1",
        },
      },
    ],
  };
  expect(() =>
    applyWf2Batch(initial, { ...done, changes: done.changes.slice(0, 2) }),
  ).toThrow();
  expect(initial.structures).toHaveLength(0);
  const s = applyWf2Batch(initial, done);
  expect(s.projects[0]?.state).toBe("completed");
  expect(s.structures).toHaveLength(1);
  expect(s.paths).toHaveLength(1);
  expect(s.cursor).toBe("2");
});
it("C05: late credit revisions cannot roll back current state or advance cursor from a credit-only response", () => {
  const newer = { ...initial, creditRevision: "5" };
  expect(() => applyWf2Batch(newer, batch)).toThrow("RESET_REQUIRED");
  expect(newer.cursor).toBe("1");
  expect(() =>
    applyWf2Batch(initial, {
      creditRevision: "2",
      credits: [{ label: "Stale name" }],
    }),
  ).toThrow();
});
