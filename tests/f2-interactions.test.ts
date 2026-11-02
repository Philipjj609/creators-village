import { it, expect } from "vitest";
import { createRequire } from "node:module";
import type {
  Wf2State,
  Wf2Project,
  Wf2Structure,
} from "../packages/contracts/src/participation.js";
import { constructionView } from "../packages/contracts/src/construction.js";
import {
  canonicalPlace,
  projectForPlace,
} from "../apps/web/src/place-project.js";
import {
  initialInteraction,
  selectionReducer,
  readInteraction,
  interactionUrl,
} from "../apps/web/src/village-selection.js";
import { ProjectInspector } from "../apps/web/src/village-panels.js";
import { placeDecor } from "../packages/renderer/src/terrain-art.js";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { createElement } = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
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

it("keeps the Projects return context across site completion and legacy project links", () => {
  const completed = {
    ...project,
    state: "completed" as const,
    acceptedCount: 2,
  };
  const state = { projects: [completed], structures: [structure] } as Wf2State;
  const site = { kind: "site" as const, id: project.id };
  let nav = selectionReducer(initialInteraction, {
    type: "listPick",
    ref: site,
    view: "projects",
  });
  expect(nav.panel).toBe("inspect");
  const ref = canonicalPlace(site, state)!;
  expect(ref).toEqual({ kind: "structure", id: structure.id });
  nav = selectionReducer(nav, { type: "replaceSelection", ref });
  expect(nav.returnView).toBe("projects");
  expect(projectForPlace(ref, state)?.id).toBe(project.id);
  expect(
    readInteraction(
      new URL(
        interactionUrl(nav, "http://localhost/villages/v"),
        "http://localhost",
      ).search,
    ),
  ).toEqual(nav);
  expect(selectionReducer(nav, { type: "back" }).panel).toBe("projects");
  expect(selectionReducer(nav, { type: "close" }).selection).toBeNull();
  expect(canonicalPlace(site, { ...state, structures: [] })).toEqual(site);
  expect(
    canonicalPlace(site, {
      ...state,
      structures: [
        { ...structure, position: { ...structure.position, height: 32 } },
      ],
    }),
  ).toEqual(site);
});
it("renders a completed place without progress, a redundant project transition or recognition controls", () => {
  const p = { ...project, state: "completed" as const, acceptedCount: 2 };
  const html = renderToStaticMarkup(
    createElement(ProjectInspector, {
      project: p,
      description: "In the clearing",
      construction: constructionView(p, [structure]),
      creator: true,
      canContribute: true,
      accessLoaded: true,
      alreadyContributed: true,
      busy: false,
      onContribute() {},
      onRetry() {},
      onCancel() {},
      findWorker() {},
      credits: ["Consented Demo Name"],
    }),
  );
  expect(html).toContain("2 accepted contributions");
  expect(html).toContain("Consented Demo Name");
  for (const text of [
    "<progress",
    "Project details",
    "Recognition preferences",
    "Map reference",
    "connecting path are saved",
  ])
    expect(html).not.toContain(text);
  const active = renderToStaticMarkup(
    createElement(ProjectInspector, {
      project,
      description: "In the clearing",
      construction: constructionView(project, []),
      creator: false,
      canContribute: true,
      accessLoaded: true,
      alreadyContributed: false,
      busy: false,
      onContribute() {},
      onRetry() {},
      onCancel() {},
      findWorker() {},
      credits: [],
    }),
  );
  expect(active).toContain("Contribute to workshop");
  expect(active).toContain("<progress");
  expect(active).not.toContain("Show my name on this project");
});
it("suppresses cosmetics deterministically when a real footprint is added without changing terrain", () => {
  const cells = () => 0,
    read = { cell: cells, height: () => 1 },
    win = { x0: -20, x1: 20, y0: -20, y1: 20 },
    caps = { decor: 700, patches: 160, glints: 24 };
  const before = placeDecor(read, win, [], caps);
  const p = before.dry[0]!;
  expect(p).toBeDefined();
  const site = { x: p.x - 3, y: p.y - 3, width: 6, depth: 7 };
  const after = placeDecor(read, win, [site], caps);
  expect(after.dry.some((d) => d.x === p.x && d.y === p.y)).toBe(false);
  expect(after).toEqual(placeDecor(read, win, [site], caps));
  expect(read.cell).toBe(cells);
});
