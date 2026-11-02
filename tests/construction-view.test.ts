import { expect, it } from "vitest";
import { constructionView } from "../packages/contracts/src/construction.js";
import type {
  Wf2Project,
  Wf2Structure,
} from "../packages/contracts/src/participation.js";
const project: Wf2Project = {
  id: "test-project",
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
    points: [
      { qx: 1792, qy: 2176 },
      { qx: 0, qy: 2176 },
    ],
    widthQ: 256,
  },
};
const structure: Wf2Structure = {
  id: "wf2-workshop-test-project",
  template: project.template,
  position: { qx: 1024, qy: 512, height: 16 },
  footprint: { widthQ: 1536, depthQ: 1536 },
  entrance: project.site.entrance,
  appearance: project.site.appearance,
  assetManifestHash: project.site.assetManifestHash,
  revision: "1",
};
it("reconstructs foundation/work from accepted facts without clock or optimistic state", () => {
  const before = structuredClone(project);
  expect(constructionView(project, []).phase).toBe("foundation");
  expect(constructionView({ ...project, acceptedCount: 1 }, []).phase).toBe(
    "building",
  );
  expect(
    constructionView({ ...project, acceptedCount: 2, state: "ready" }, [])
      .phase,
  ).toBe("building");
  expect(constructionView(project, [])).toEqual(
    constructionView(JSON.parse(JSON.stringify(project)), []),
  );
  expect(project).toEqual(before);
});
it("never treats counts, elapsed time or even completed status alone as a saved building", () => {
  expect(constructionView({ ...project, acceptedCount: 2 }, []).phase).toBe(
    "building",
  );
  expect(
    constructionView({ ...project, state: "completed", acceptedCount: 2 }, [])
      .phase,
  ).toBe("awaiting-structure");
  expect(
    constructionView({ ...project, state: "open" }, [structure]).phase,
  ).toBe("foundation");
});
it("requires the same completed structure identity, anchor, height and footprint", () => {
  const p = { ...project, state: "completed" as const, acceptedCount: 2 };
  expect(constructionView(p, [structure]).phase).toBe("completed");
  for (const s of [
    { ...structure, id: "another" },
    { ...structure, template: "other" },
    { ...structure, position: { ...structure.position, qx: 1025 } },
    { ...structure, position: { ...structure.position, height: 17 } },
    { ...structure, footprint: { widthQ: 1280, depthQ: 1536 } },
  ])
    expect(constructionView(p, [s]).phase).toBe("awaiting-structure");
});
it("keeps the exact site frame through foundation, progress, ready, blocked and completion", () => {
  const frames = [
    project,
    { ...project, acceptedCount: 1 },
    { ...project, state: "ready" as const, acceptedCount: 2 },
    { ...project, state: "blocked" as const, acceptedCount: 2 },
    { ...project, state: "completed" as const, acceptedCount: 2 },
  ].map((p) => constructionView(p, [structure]));
  for (const f of frames)
    expect([f.center, f.footprint, f.height]).toEqual([
      frames[0]!.center,
      frames[0]!.footprint,
      frames[0]!.height,
    ]);
  expect(frames[3]!.label).toBe("Construction needs attention");
});
it("does not expose a live site for a private draft or a cancelled reservation", () => {
  for (const state of ["draft", "cancelled"] as const)
    expect(constructionView({ ...project, state }, []).phase).toBe("hidden");
});
