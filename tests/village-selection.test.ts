import { describe, it, expect } from "vitest";
import {
  initialInteraction as base,
  selectionReducer as step,
  readInteraction,
  interactionUrl,
} from "../apps/web/src/village-selection.js";
const resident = { kind: "resident", id: "v:lw1:nell" } as const,
  building = { kind: "structure", id: "shelter" } as const;
describe("single village interaction owner", () => {
  it("preserves Projects context for its buildings while inhabitants return to People", () => {
    expect(
      step(base, { type: "listPick", ref: resident, view: "projects" })
        .returnView,
    ).toBe("people");
    expect(
      step(base, { type: "listPick", ref: building, view: "projects" })
        .returnView,
    ).toBe("projects");
    expect(
      step(base, {
        type: "listPick",
        ref: { kind: "site", id: "p" },
        view: "projects",
      }).returnView,
    ).toBe("projects");
  });
  it("preserves invariants through every event across list, world, follow and planning states", () => {
    const states = [
      base,
      step(base, { type: "open", view: "people" }),
      step(base, { type: "worldPick", ref: resident }),
      step(base, { type: "listPick", ref: building }),
      step(step(base, { type: "listPick", ref: resident }), {
        type: "followToggle",
      }),
      step(base, { type: "planMode", on: true }),
    ];
    const events = [
      { type: "worldPick", ref: null },
      { type: "worldPick", ref: resident },
      { type: "worldPick", ref: building },
      { type: "listPick", ref: resident },
      { type: "tab", view: "places" },
      { type: "open", view: "projects" },
      { type: "close" },
      { type: "back" },
      { type: "escape" },
      { type: "cameraManual" },
      { type: "followToggle" },
      { type: "planMode", on: true },
      { type: "planMode", on: false },
      { type: "objectRemoved", id: resident.id },
    ] as const;
    for (const state of states)
      for (const event of events) {
        const next = step(state, event);
        if (next.following)
          expect(next.selection).toEqual({
            kind: "resident",
            id: next.following,
          });
        if (next.selection)
          expect(["resident", "inspect", "landmark", "projects"]).toContain(
            next.panel,
          );
        if (next.planMode) {
          expect(next.selection).toBeNull();
          expect(next.panel).toBe("plan");
        }
      }
  });
  it("toggles world picks, replaces selection and clears empty terrain", () => {
    let s = step(base, { type: "worldPick", ref: resident });
    expect(s.selection).toEqual(resident);
    s = step(s, { type: "worldPick", ref: resident });
    expect(s.selection).toBeNull();
    s = step(step(base, { type: "worldPick", ref: resident }), {
      type: "worldPick",
      ref: building,
    });
    expect(s.selection).toEqual(building);
    expect(step(s, { type: "worldPick", ref: null }).panel).toBe("");
  });
  it("returns through a directory before closing, and close clears everything", () => {
    const s = step(base, { type: "listPick", ref: resident });
    for (const type of ["back", "escape"] as const) {
      const back = step(s, { type });
      expect(back.selection).toBeNull();
      expect(back.panel).toBe("people");
      expect(step(back, { type: "escape" }).panel).toBe("");
    }
    expect(step(s, { type: "close" })).toEqual(base);
    expect(step(s, { type: "worldPick", ref: null }).panel).toBe("people");
  });
  it("manual camera stops follow without losing selection; tab clears it", () => {
    let s = step(step(base, { type: "listPick", ref: resident }), {
      type: "followToggle",
    });
    expect(s.following).toBe(resident.id);
    expect(step(s, { type: "cameraManual" })).toMatchObject({
      following: null,
      selection: resident,
      panel: "resident",
    });
    expect(step(s, { type: "followToggle" }).following).toBeNull();
    s = step(s, { type: "tab", view: "people" });
    expect(s.selection).toBeNull();
    expect(s.panel).toBe("people");
    expect(step(s, { type: "tab", view: "people" }).panel).toBe("");
  });
  it("protects placement terrain handling and removes missing objects", () => {
    const plan = step(base, { type: "planMode", on: true });
    expect(step(plan, { type: "worldPick", ref: null })).toEqual(plan);
    expect(step(plan, { type: "worldPick", ref: building })).toEqual(plan);
    expect(step(plan, { type: "escape" }).planMode).toBe(false);
    const s = step(base, { type: "listPick", ref: building });
    expect(step(s, { type: "objectRemoved", id: "other" })).toBe(s);
    expect(
      step(s, { type: "objectRemoved", id: "shelter" }).selection,
    ).toBeNull();
  });
  it("round trips real detail refs and rejects missing legacy detail items", () => {
    const s = step(base, {
      type: "listPick",
      ref: { kind: "site", id: "p" },
      view: "projects",
    });
    expect(
      readInteraction(
        new URL(
          interactionUrl(s, "http://localhost/villages/v"),
          "http://localhost",
        ).search,
      ),
    ).toEqual(s);
    expect(readInteraction("?panel=resident").panel).toBe("people");
  });
});
