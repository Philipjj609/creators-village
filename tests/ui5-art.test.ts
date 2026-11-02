import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  residentArtwork,
  prepareResidentArtwork,
  artDirection,
  semanticAnimation,
  walkFrame,
} from "../packages/renderer/src/resident-art.js";
import { visualFit } from "../packages/renderer/src/art.js";
import { ambientBudget } from "../packages/renderer/src/ambient.js";
import { foundingStructure } from "../packages/world/src/founding-spatial.js";
import type { ResidentState } from "../packages/contracts/src/living.js";

it("waits for the complete atlas set and disposes stale or partially failed character loads", async () => {
  let finish: ((value: string) => void) | undefined;
  let published = false;
  const pending = prepareResidentArtwork(
    ["first", "slow"],
    (id) =>
      id === "slow"
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(id),
    () => true,
    () => {},
  ).then((value) => {
    published = true;
    return value;
  });
  await Promise.resolve();
  expect(published).toBe(false);
  finish!("slow");
  expect(await pending).toHaveLength(2);
  const disposed: string[] = [];
  await expect(
    prepareResidentArtwork(
      ["ok", "broken"],
      async (id) => {
        if (id === "broken") throw Error("missing atlas");
        return id;
      },
      () => true,
      (id) => {
        disposed.push(id);
      },
    ),
  ).rejects.toThrow("missing atlas");
  expect(disposed).toEqual(["ok"]);
  expect(
    await prepareResidentArtwork(
      ["stale"],
      async (id) => id,
      () => false,
      (id) => {
        disposed.push(id);
      },
    ),
  ).toBeNull();
  expect(disposed).toEqual(["ok", "stale"]);
});

it("keeps fictional identity bindings stable and never creates artwork for an unrelated identity", () => {
  expect(
    ["ivo", "nell", "mira", "oren"].map((id) =>
      residentArtwork("world:lw1:" + id),
    ),
  ).toEqual(["gardener", "maker", "courier", "caretaker"]);
  expect(residentArtwork("twitch:someone")).toBeNull();
});
it("maps actual movement direction without flipping anchors or changing trajectories", () => {
  expect(
    [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ].map(artDirection),
  ).toEqual(["se", "sw", "nw", "ne"]);
  expect(walkFrame(0.2, 0.4, 8)).toBe(4);
  expect(walkFrame(0.4, 0.4, 8)).toBe(0);
  expect(walkFrame(1.6, 0.4, 8)).toBe(0);
});
it("uses real semantic activity and only an explicitly triggered reaction", () => {
  const state = {
    activity: "work",
    actionPhase: "performing",
  } as ResidentState;
  expect(semanticAnimation(state, false)).toBe("work");
  expect(semanticAnimation({ ...state, actionPhase: "arriving" }, false)).toBe(
    "idle",
  );
  expect(semanticAnimation(state, true)).toBe("react");
  expect(semanticAnimation({ ...state, activity: "travel" }, true)).toBe(
    "walk",
  );
});
it("uniformly fits art inside a saved envelope without modifying the saved structure", () => {
  const saved = foundingStructure(),
    before = JSON.stringify(saved),
    fit = visualFit(saved.width, saved.depth, 6, 6);
  expect(fit).toBe(1 / 3);
  expect(6 * fit).toBeLessThanOrEqual(saved.width);
  expect(6 * fit).toBeLessThanOrEqual(saved.depth);
  expect(visualFit(6, 6, 6, 6)).toBe(1);
  expect(visualFit(2, 2, 4, 4)).toBe(0.5);
  expect(JSON.stringify(saved)).toBe(before);
  expect(() => visualFit(-1, 2, 4, 4)).toThrow();
});
it("enforces supplied ambient budgets, daylight conditions, zoom gates and reduced motion", () => {
  for (const evening of [false, true])
    for (const reduced of [false, true])
      for (const scale of [0.3, 0.45, 2.6]) {
        const b = ambientBudget(500, 500, 500, 500, evening, reduced, scale);
        expect(b.total).toBeLessThanOrEqual(60);
        expect(b.firefly).toBeLessThanOrEqual(24);
        expect(b.butterfly).toBeLessThanOrEqual(6);
        if (reduced) expect(b.smoke + b.leaf + b.butterfly).toBe(0);
        if (scale < 0.45)
          expect(b.smoke + b.leaf + b.butterfly + b.firefly).toBe(0);
        if (evening) expect(b.butterfly).toBe(0);
        else expect(b.firefly + b.lantern).toBe(0);
      }
});
it("keeps every imported runtime byte pinned and atlas animations consistent with cast metadata", () => {
  const catalog = JSON.parse(
    readFileSync("assets/generated/cv-ui5-01/catalog.json", "utf8"),
  );
  for (const f of catalog.files)
    expect(
      createHash("sha256").update(readFileSync(f.source)).digest("hex"),
    ).toBe(f.sha256);
  const cast = catalog.bundles["cv-artlab-cast-02"];
  for (const character of cast.cast) {
    for (const [animation, metadata] of Object.entries(
      character.animations,
    ) as [string, { frames: number; directions: string[] }][]) {
      const group =
          animation === "idle" || animation === "walk" ? "loco" : "act",
        page = cast.pages.find(
          (p: { character: string; group: string }) =>
            p.character === character.id && p.group === group,
        );
      const sheet = JSON.parse(
        readFileSync(
          "assets/generated/cv-artlab-cast-02/" + page.spritesheet,
          "utf8",
        ),
      );
      for (const direction of metadata.directions)
        expect(
          sheet.animations[character.id + "/" + animation + "-" + direction],
        ).toHaveLength(metadata.frames);
    }
  }
});
