import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test, expect } from "vitest";
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
test("H01 original source, retained helper and packed assets match recorded provenance and budget", () => {
  const root = "assets/generated/hearthside-hero-01",
    m = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
  expect(m.buildings.map((b: any) => b.id)).toEqual([
    "home",
    "workshop",
    "commons",
  ]);
  expect(sha("assets/source/hearthside-hero-01/build.py")).toBe(
    m.sourceHashes.build,
  );
  expect(sha("assets/source/hearthside-hero-01/recipe.json")).toBe(
    m.sourceHashes.recipe,
  );
  expect(sha("assets/source/v04-neighborhood-study-01/kit.py")).toBe(
    m.sourceHashes.kit,
  );
  for (const f of m.outputs)
    expect(sha(`${root}/${f.file}`), f.file).toBe(f.sha256);
  for (const b of m.buildings)
    expect(m.baseDecodedBytes + b.detail.decodedBytes).toBeLessThan(
      32 * 2 ** 20,
    );
});
