import { describe, it, expect } from "vitest";
import {
  chunkOf,
  overlaps,
  project,
  quantize,
  unproject,
} from "../packages/domain/src/index.js";
import {
  generateWorld,
  readCompatibleWorld,
} from "../packages/world/src/index.js";
import fs from "node:fs";
describe("E1 retained spatial contract", () => {
  it("round-trips positive/negative/elevated world coordinates", () => {
    for (const x of [-33, -1, 0, 0.25, 32, 100])
      for (const y of [-35, -0.5, 0, 31.99])
        for (const z of [0, 1, 4]) {
          const p = project(x, y, z),
            q = unproject(p.x, p.y, z);
          expect(quantize(q.x)).toBe(quantize(x));
          expect(quantize(q.y)).toBe(quantize(y));
        }
  });
  it("floors negative chunks and rejects unsupported positions", () => {
    expect(chunkOf(-1)).toBe(-1);
    expect(chunkOf(8191)).toBe(0);
    expect(chunkOf(8192)).toBe(1);
    expect(() => quantize(NaN)).toThrow();
  });
  it("handles overlap across chunk boundary and permits touching edges", () => {
    const a = { x: 8190, y: 0, width: 512, depth: 512 };
    expect(overlaps(a, { x: 8192, y: 0, width: 512, depth: 512 })).toBe(true);
    expect(overlaps(a, { x: 8702, y: 0, width: 512, depth: 512 })).toBe(false);
  });
  it("produces stable materialized recipes and distinct geography", () => {
    const a = {
      id: "fixture",
      name: "Fixture",
      createdAt: "2026-10-28T00:00:00Z",
      source: "showcase" as const,
    };
    expect(generateWorld("fern", a)).toEqual(generateWorld("fern", a));
    expect(generateWorld("fern", a).terrain).not.toEqual(
      generateWorld("willow", a).terrain,
    );
    expect(
      new Set(generateWorld("fern", a).buildings.map((b) => b.recipe.shape))
        .size,
    ).toBe(5);
  });
  it("reads the archived v1 fixture unchanged and refuses unknown versions", () => {
    const a = JSON.parse(
      fs.readFileSync("tests/fixtures/world-v1.json", "utf8"),
    );
    expect(readCompatibleWorld(a)).toEqual(a);
    expect(() => readCompatibleWorld({ ...a, assetVersion: "future" })).toThrow(
      "explicit migration",
    );
  });
});
