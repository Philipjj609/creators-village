import { createHash } from "node:crypto";
import {
  FOUNDING_GENERATOR,
  FOUNDING_PROFILE,
  type FoundingBaseline,
  type FoundingWorld,
  type TerrainChunk,
} from "@creators-village/contracts";
import {
  WATER,
  TREE,
  ROCK,
  terrainReader,
  walkGrid,
  reachable,
  validateSite,
  foundingStructure,
} from "./founding-spatial.js";
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
/** Pinned descriptor ordering survives JSONB key reordering; matches existing profile2 hashes. */
export function baselineDigest(
  b: Pick<
    FoundingBaseline,
    "generator" | "profile" | "seed" | "landform" | "certificate"
  > & { chunks: Pick<TerrainChunk, "x" | "y" | "hash">[] },
) {
  const c = b.certificate;
  return digest(
    JSON.stringify({
      generator: b.generator,
      profile: b.profile,
      seed: b.seed,
      landform: b.landform,
      certificate: {
        version: c.version,
        valid: c.valid,
        opportunities: c.opportunities,
        expansionOpportunities: c.expansionOpportunities,
        exits: c.exits,
        repairs: c.repairs,
      },
      chunks: [...b.chunks]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((c) => [c.x, c.y, c.hash]),
    }),
  );
}
function seedWord(seed: string, label: string) {
  const parts = [seed.normalize("NFC"), label];
  const bytes = parts.map((s) => `${Buffer.byteLength(s)}:${s}`).join("");
  return createHash("sha256").update(bytes).digest().readUInt32LE();
}
// Pinned unsigned integer avalanche (not security); independent coordinate/feature streams.
function noise(seed: number, x: number, y: number) {
  let a = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  return (a ^ (a >>> 16)) >>> 0;
}
function field(seed: number, x: number, y: number, step: number) {
  const ix = Math.floor(x / step),
    iy = Math.floor(y / step),
    u = x - ix * step,
    v = y - iy * step;
  const h = (dx: number, dy: number) =>
    (noise(seed, ix + dx, iy + dy) % 33) - 16;
  return Math.round(
    (h(0, 0) * (step - u) * (step - v) +
      h(1, 0) * u * (step - v) +
      h(0, 1) * (step - u) * v +
      h(1, 1) * u * v) /
      (step * step),
  );
}
export function encodeChunk(c: Pick<TerrainChunk, "heights" | "cells">) {
  const out = Buffer.alloc(c.heights.length * 2 + c.cells.length);
  c.heights.forEach((v, i) => out.writeInt16LE(v, i * 2));
  Buffer.from(c.cells).copy(out, c.heights.length * 2);
  return out;
}
export function decodeChunk(
  x: number,
  y: number,
  bytes: Buffer,
  hash: string,
): TerrainChunk {
  if (bytes.length !== 33 * 33 * 2 + 32 * 32 || digest(bytes) !== hash)
    throw Error("Invalid persisted terrain chunk");
  return {
    x,
    y,
    hash,
    heights: Array.from({ length: 1089 }, (_, i) => bytes.readInt16LE(i * 2)),
    cells: [...bytes.subarray(2178)],
  };
}
export function generateBaseline(seed: string): FoundingBaseline {
  const hseed = seedWord(seed, "height-v1"),
    fseed = seedWord(seed, "features-v1"),
    plan = seedWord(seed, "plan-v1"),
    mode = plan % 3;
  const landform = (["creek-bend", "lake-edge", "wooded-ridge"] as const)[
    mode
  ]!;
  const height = (x: number, y: number) => {
    const d = Math.max(Math.abs(x), Math.abs(y));
    const base =
      16 +
      field(hseed, x, y, 32) +
      Math.floor(field(hseed ^ 123, x, y, 96) / 2);
    return Math.round(
      (16 * (12 - Math.min(12, Math.max(0, d - 12))) +
        base * Math.min(12, Math.max(0, d - 12))) /
        12,
    );
  };
  // Smooth monotone outlet direction. No fluid simulation: static water surface and pinned bed.
  const water = (x: number, y: number) =>
    mode === 0
      ? Math.abs(x - (25 + Math.trunc(field(plan, 0, y, 64) / 3))) <= 2
      : mode === 1
        ? (x - 43) ** 2 * 2 + (y + 8) ** 2 < 29 ** 2
        : false;
  const hh = (x: number, y: number) =>
    water(x, y) ? Math.min(8, height(x, y)) : height(x, y);
  const chunks: TerrainChunk[] = [];
  for (let cy = -8; cy < 8; cy++)
    for (let cx = -8; cx < 8; cx++) {
      const heights: number[] = [],
        cells: number[] = [];
      for (let y = 0; y <= 32; y++)
        for (let x = 0; x <= 32; x++)
          heights.push(hh(cx * 32 + x, cy * 32 + y));
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const gx = cx * 32 + x,
            gy = cy * 32 + y,
            n = noise(fseed, gx, gy),
            d = Math.max(Math.abs(gx), Math.abs(gy));
          const wet = [
            water(gx, gy),
            water(gx + 1, gy),
            water(gx, gy + 1),
            water(gx + 1, gy + 1),
          ].some(Boolean);
          const forest = field(fseed, gx, gy, 48) > -3;
          cells.push(
            wet
              ? WATER
              : d < 15 ||
                  (d < 48 &&
                    ((gx <= 0 && Math.abs(gy) < 2) ||
                      (gy <= 0 && Math.abs(gx) < 2)))
                ? 0
                : forest && n % 19 === 0
                  ? TREE
                  : n % 701 === 0
                    ? ROCK
                    : forest
                      ? 8
                      : 0,
          );
        }
      const c = { x: cx, y: cy, heights, cells, hash: "" };
      c.hash = digest(encodeChunk(c));
      chunks.push(c);
    }
  const b: FoundingBaseline = {
    format: 2,
    generator: FOUNDING_GENERATOR,
    profile: FOUNDING_PROFILE,
    seed: seed.normalize("NFC"),
    min: -256,
    size: 512,
    chunkSize: 32,
    heightUnits: 16,
    hash: "",
    landform,
    chunks,
    certificate: {
      version: 1,
      valid: true,
      opportunities: 0,
      expansionOpportunities: 0,
      exits: 0,
      repairs: [
        "bounded founding terrace; sparse obstacles excluded within 15-cell founding meadow",
      ],
    },
  };
  const shelter = foundingStructure(),
    active = { centerX: 0, centerY: 0, radius: 32, version: 1 as const };
  const grid = walkGrid(b, chunks, active, [shelter]);
  const opportunities = [
    [-8, -7],
    [-3, -7],
    [3, -7],
    [7, -7],
    [-8, 5],
    [-3, 5],
    [3, 5],
    [7, 5],
  ];
  b.certificate.opportunities = opportunities.filter(([x, y]) =>
    validateSite(b, chunks, { x: x!, y: y!, width: 3, depth: 3 }),
  ).length;
  const exits = [
    { x: -40, y: 0 },
    { x: 0, y: -40 },
  ];
  const futureGrid = walkGrid(b, chunks, { ...active, radius: 64 }, [shelter]);
  let expansionFits = 0;
  for (const transpose of [false, true]) {
    let fit = false;
    for (let x = -58; x < -35 && !fit; x += 3)
      for (let y = -12; y < 12 && !fit; y += 3)
        if (
          validateSite(b, chunks, {
            x: transpose ? y : x,
            y: transpose ? x : y,
            width: 3,
            depth: 3,
          }) &&
          reachable(futureGrid, shelter.entrance, [
            { x: transpose ? y : x, y: transpose ? x : y },
          ])
        )
          fit = true;
    if (fit) expansionFits++;
  }
  b.certificate.expansionOpportunities = expansionFits;
  b.certificate.exits = exits.filter((p) =>
    reachable(futureGrid, shelter.entrance, [p]),
  ).length;
  if (
    b.certificate.opportunities < 8 ||
    b.certificate.exits < 2 ||
    b.certificate.expansionOpportunities < 2 ||
    !validateSite(b, chunks, shelter) ||
    !reachable(grid, shelter.entrance, [{ x: 0, y: 9 }])
  )
    throw Error("Founding geography failed certification");
  b.hash = baselineDigest(b);
  return b;
}
export function worldHeader(
  b: FoundingBaseline,
  identity: {
    id: string;
    name: string;
    createdAt: string;
    source: "creator" | "showcase";
    purpose: "active" | "development";
  },
): FoundingWorld {
  const { chunks: _, ...baseline } = b;
  return {
    schemaVersion: 2,
    ...identity,
    baseline,
    active: { centerX: 0, centerY: 0, radius: 32, version: 1 },
    structure: foundingStructure(),
    path: {
      id: "founding-path",
      width: 1.5,
      points: [
        { x: 0, y: 1.5 },
        { x: 0, y: 9 },
      ],
    },
    publicCursor: "1",
    topologyEpoch: "1",
  };
}
export function readFoundingWorld(v: unknown): FoundingWorld {
  const w = v as FoundingWorld;
  if (
    w?.schemaVersion !== 2 ||
    w.baseline?.generator !== FOUNDING_GENERATOR ||
    w.baseline.profile !== FOUNDING_PROFILE ||
    w.baseline.size !== 512 ||
    w.baseline.chunkSize !== 32 ||
    w.baseline.heightUnits !== 16
  )
    throw Error("Unsupported founding-world format");
  return w;
}
export { terrainReader };
