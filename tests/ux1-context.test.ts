import { it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { createElement } = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
import { Panel } from "../apps/web/src/VillageChrome.js";
import {
  describePlace,
  villagePlaces,
} from "../apps/web/src/place-descriptor.js";
import {
  projectSelection,
  selectionFrame,
} from "../packages/renderer/src/selection.js";
import { searchText } from "../apps/web/src/VillageDirectory.js";
import type { Wf2State } from "../packages/contracts/src/participation.js";
it("uses one compact navigation header with real locate and close actions", () => {
  const detail = renderToStaticMarkup(
    createElement(
      Panel,
      {
        title: "Building",
        onClose() {},
        back: { label: "Places", onBack() {} },
        locate() {},
      },
      createElement("h3", null, "Gathering Shelter"),
    ),
  );
  expect(detail).not.toContain("<h2>");
  expect(detail).toContain("Places");
  expect(detail).toContain('aria-label="Show in village"');
  expect(detail).toContain('aria-label="Close panel"');
  expect(detail).not.toContain("All projects");
  const list = renderToStaticMarkup(
    createElement(Panel, { title: "Places · 2", onClose() {} }, "List"),
  );
  expect(list).toContain("<h2>Places · 2</h2>");
  expect(list).not.toContain('aria-label="Show in village"');
});
it("clears every projection before drawing a single selected object", () => {
  let object = false,
    resident = "";
  const apply = (r: Parameters<typeof projectSelection>[0]) =>
    projectSelection(
      r,
      () => {
        object = false;
      },
      (id) => {
        resident = id;
      },
      () => {
        object = true;
      },
    );
  apply({ kind: "structure", id: "s" });
  expect([object, resident]).toEqual([true, ""]);
  apply({ kind: "resident", id: "r" });
  expect([object, resident]).toEqual([false, "r"]);
  apply({ kind: "site", id: "p" });
  expect([object, resident]).toEqual([true, ""]);
  apply(null);
  expect([object, resident]).toEqual([false, ""]);
});
it("uses actual logical bearings and deterministic distance ties without coordinates", () => {
  const shelter = { id: "s", name: "Gathering Shelter", x: 0, y: 0 };
  expect(describePlace({ id: "t", name: "", x: 2, y: 0 }, [shelter])).toBe(
    "Beside Gathering Shelter",
  );
  expect(describePlace({ id: "t", name: "", x: 7, y: -7 }, [shelter])).toBe(
    "Northeast of Gathering Shelter",
  );
  expect(describePlace({ id: "t", name: "", x: 17, y: 0 }, [shelter])).toBe(
    "Out past Gathering Shelter, to the east",
  );
  expect(
    describePlace({ id: "t", name: "", x: 0, y: 0 }, [
      { id: "b", name: "B", x: 1, y: 0 },
      { id: "a", name: "A", x: -1, y: 0 },
    ]),
  ).toBe("Beside A");
  expect(describePlace(shelter, [shelter])).toBe("In the village clearing");
});
it("retains one stable place identity across real site-to-building completion", () => {
  const project = {
    id: "p",
    state: "open",
    acceptedCount: 0,
    goal: 2,
    site: { qx: 1792, qy: 1280 },
  };
  const state = { projects: [project], structures: [] } as unknown as Wf2State;
  const site = villagePlaces(state, null);
  expect(site).toHaveLength(1);
  expect(site[0]?.key).toBe("wf2-workshop-p");
  expect(site[0]?.ref.kind).toBe("site");
  const built = {
    ...state,
    projects: [{ ...state.projects[0]!, state: "completed" as const }],
    structures: [
      {
        id: "wf2-workshop-p",
        template: "wf2-workshop-1",
        position: { qx: 1024, qy: 512 },
        footprint: { widthQ: 1536, depthQ: 1536 },
      },
    ],
  } as Wf2State;
  const after = villagePlaces(built, null);
  expect(after).toHaveLength(1);
  expect(after[0]?.key).toBe(site[0]?.key);
  expect(after[0]?.ref.kind).toBe("structure");
  expect(after[0]?.x).toBe(7);
  expect(after[0]?.y).toBe(5);
  expect(
    villagePlaces(
      { ...state, projects: [{ ...state.projects[0]!, state: "cancelled" }] },
      null,
    ),
  ).toHaveLength(0);
});
it("frames and nudges inside real desktop and mobile safe areas", () => {
  for (const frame of [
    { x: 16, y: 76, width: 1040, height: 808 },
    { x: 16, y: 136, width: 358, height: 230 },
  ]) {
    const center = selectionFrame(
      { x: 900, y: 600 },
      frame,
      { width: 80, height: 80 },
      1,
      "frame",
    );
    expect(center.x).toBe(frame.x + frame.width / 2);
    expect(center.y).toBe(frame.y + frame.height / 2);
    const nudge = selectionFrame(
      { x: 900, y: 600 },
      frame,
      { width: 80, height: 80 },
      1,
      "nudge",
    );
    expect(nudge.x + 40).toBeLessThanOrEqual(frame.x + frame.width);
    expect(nudge.y + 40).toBeLessThanOrEqual(frame.y + frame.height);
    expect(
      selectionFrame(center, frame, { width: 20, height: 20 }, 1, "nudge"),
    ).toEqual(center);
  }
  expect(searchText("Míra Fen")).toBe("mira fen");
});
