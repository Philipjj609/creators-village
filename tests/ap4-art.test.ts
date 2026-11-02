import { it, expect, vi } from "vitest";
import {
  MeshSimple,
  Texture,
} from "../packages/renderer/node_modules/pixi.js/lib/index.mjs";
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  placeDecor,
  material,
  drawPaths,
} from "../packages/renderer/src/terrain-art.js";
it("releases scene-owned path geometry on rebuild while retaining shared texture sources", () => {
  const tex = {
    "path-dirt": Texture.EMPTY,
    "path-fringe": Texture.EMPTY,
    "path-joint": Texture.EMPTY,
  };
  const layer = drawPaths(
    { cell: () => 0, height: () => 1 },
    tex,
    [
      {
        width: 1.5,
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 3 },
        ],
      },
    ],
    { provisional: false },
  );
  const meshes = layer.children.filter(
    (n): n is MeshSimple => n instanceof MeshSimple,
  );
  expect(meshes).toHaveLength(2);
  const cleanup = meshes.map((m) => vi.spyOn(m.geometry, "destroy"));
  expect(meshes.every((m) => !m.autoUpdate)).toBe(true);
  layer.destroy({ children: true });
  for (const spy of cleanup) expect(spy).toHaveBeenCalledWith(true);
  expect(Texture.EMPTY.destroyed).toBe(false);
});
import { terrainWindow } from "../packages/renderer/src/viewport-bounds.js";
import { vegetationScale } from "../packages/renderer/src/vegetation.js";
const catalogue = JSON.parse(
  fs.readFileSync("assets/generated/cv-ap4-01/catalog.json", "utf8"),
);
it("pins every imported AP4 output, dimensions, anchors and unchanged workshop-03", () => {
  const prior = JSON.parse(
    fs.readFileSync("assets/generated/cv-ui5-01/catalog.json", "utf8"),
  );
  for (const file of prior.files)
    expect(
      catalogue.files.find((f: { url: string }) => f.url === file.url),
    ).toEqual(file);
  for (const file of catalogue.files.filter((f: { url: string }) =>
    f.url.includes("/cv-artlab-ap4-"),
  )) {
    const bytes = fs.readFileSync(file.source);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    if (file.source.endsWith(".png"))
      expect(bytes.readUInt32BE(16) * bytes.readUInt32BE(20) * 4).toBe(
        file.decodedBytes,
      );
  }
  const shelter = catalogue.bundles["cv-artlab-ap4-shelter-01"].buildings[0];
  const stages = catalogue.bundles["cv-artlab-ap4-construction-01"].buildings;
  const workshop = catalogue.bundles["cv-artlab-ve01-workshop-03"].buildings[0];
  for (const model of [shelter, ...stages])
    expect(model.screenAnchor).toEqual(workshop.screenAnchor);
  for (const stage of stages) {
    expect(stage.footprintReference.envelope.width).toBe(6);
    expect(stage.footprintReference.envelope.depth).toBe(6);
  }
});
it("decoration is deterministic, cosmetic, bounded across categories and excludes real sites/paths/missing terrain", () => {
  const read = {
    cell: (x: number, y: number) =>
      x < -20 || x >= 20 || y < -20 || y >= 20
        ? 255
        : y > 5
          ? 1
          : x < -8
            ? 8
            : (x + y) % 9 === 0
              ? 4
              : 0,
    height: () => 1,
  };
  const win = { x0: -25, x1: 25, y0: -25, y1: 25 },
    blocked = [{ x: -3, y: -3, width: 6, depth: 7 }],
    caps = { decor: 30, patches: 5, glints: 2 };
  const a = placeDecor(read, win, blocked, caps),
    b = placeDecor(read, win, blocked, caps);
  expect(a).toEqual(b);
  expect(a.dry.length + a.rock.length + a.water.length).toBeLessThanOrEqual(30);
  expect(a.patch.length).toBeLessThanOrEqual(5);
  expect(a.glint.length).toBeLessThanOrEqual(2);
  for (const p of [...a.dry, ...a.rock, ...a.water, ...a.patch, ...a.glint]) {
    expect(read.cell(Math.floor(p.x), Math.floor(p.y))).not.toBe(255);
    expect(p.x >= -3 && p.x < 3 && p.y >= -3 && p.y < 4).toBe(false);
  }
  for (const p of a.water)
    expect(read.cell(Math.floor(p.x), Math.floor(p.y)) & 1).toBe(1);
  const hidden = placeDecor(read, win, [], caps, () => false);
  expect(Object.values(hidden).flat()).toEqual([]);
  expect(material(1)).toBe("water");
  expect(material(8)).toBe("woodland");
  expect(material(4)).toBe("grass");
});
it("uses family proportions and a quantized guarded cell window inside real terrain bounds", () => {
  expect(vegetationScale("oak-tall") * 3.691).toBeGreaterThan(5);
  expect(vegetationScale("oak-young") * 2.255).toBeLessThan(2.5);
  expect(vegetationScale("blossom")).not.toBe(vegetationScale("oak-old"));
  const baseline = { min: -128, size: 256, chunkSize: 32 };
  for (const scale of [0.2, 0.7, 1.4, 2.6]) {
    const v = terrainWindow(1440, 900, 720, 468, scale, baseline);
    expect(v.cells.x0).toBeGreaterThanOrEqual(-128);
    expect(v.cells.x1).toBeLessThanOrEqual(128);
    expect(v.cells.x0).toBeGreaterThanOrEqual(v.x0 * 32);
    expect(v.cells.x1).toBeLessThanOrEqual((v.x1 + 1) * 32);
  }
});
