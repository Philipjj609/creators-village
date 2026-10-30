import { it, expect } from "vitest";
import {
  generateBaseline,
  terrainReader,
} from "../packages/world/src/founding.js";
import {
  terrainProject,
  pickGround,
} from "../packages/renderer/src/founding-projection.js";
it("matches fixed Blender axes and picks elevated, bank, water and cross-chunk ground triangles", () => {
  const b = generateBaseline("hearth"),
    read = terrainReader(b, b.chunks);
  expect(terrainProject(1, 0, 0)).toEqual({ x: 32, y: 16 });
  expect(terrainProject(0, 1, 0)).toEqual({ x: -32, y: 16 });
  for (const [x, y] of [
    [-0.25, -0.25],
    [0, 0],
    [31.25, 2.25],
    [-32.25, -4.25],
    [24.25, 12.25],
  ]) {
    const height = read.cell(x!, y!) & 1 ? 0.5 : read.height(x!, y!)!;
    const p = terrainProject(x!, y!, height),
      hit = pickGround(p.x, p.y, read);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(x!, 5);
    expect(hit!.y).toBeCloseTo(y!, 5);
    expect(hit!.height).toBeCloseTo(height, 5);
  }
});
