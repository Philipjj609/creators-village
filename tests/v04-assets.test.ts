import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
const root = "assets/generated/v04-neighborhood-study-01";
const sha = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
test("V04 retained content bundle matches source and immutable output hashes", () => {
  const m = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
  for (const [name, file] of Object.entries({
    build: "build.py",
    kit: "kit.py",
    recipe: "recipe.json",
  }))
    expect(sha(`assets/source/v04-neighborhood-study-01/${file}`)).toBe(
      m.sourceHashes[name],
    );
  for (const f of m.outputs)
    expect(sha(`${root}/${f.file}`), f.file).toBe(f.sha256);
  expect(new Set(m.layers.map((l: any) => l.id)).size).toBe(m.layers.length);
  expect(m.layers.filter((l: any) => l.kind === "ground")).toHaveLength(4);
  expect(m.layers.filter((l: any) => l.kind === "building")).toHaveLength(5);
  const base = m.layers.reduce(
    (sum: number, l: any) => sum + l.width * l.height * 4,
    0,
  );
  expect(base).toBe(m.baseDecodedBytes);
  for (const b of m.buildings) {
    expect(b.detail.scale).toBe(2 / 3);
    expect(base + b.detail.decodedBytes).toBeLessThan(32 * 2 ** 20);
  }
  for (const l of [...m.layers, ...m.buildings.map((b: any) => b.detail)])
    expect(Math.max(l.width, l.height)).toBeLessThanOrEqual(2048);
});
