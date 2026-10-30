import { it, expect } from "vitest";
import {
  generateBaseline,
  baselineDigest,
  encodeChunk,
  decodeChunk,
  worldHeader,
  readFoundingWorld,
} from "../packages/world/src/founding.js";
import {
  terrainReader,
  halfClaims,
  walkGrid,
  reachable,
  foundingStructure,
  validateSite,
} from "../packages/world/src/founding-spatial.js";
it("retains canonical chunks, shared edges, negative addressing and identity-independent geography", () => {
  const b = generateBaseline("fern"),
    read = terrainReader(b, b.chunks);
  expect(b.hash).toBe(
    "eb769e4340f56748fbe4a2d2ff9154e46e49d7603be9e85da07c7c1cf5c3bdf5",
  );
  const c = b.chunks.find((c) => c.x === -1 && c.y === 0)!,
    right = b.chunks.find((c) => c.x === 0 && c.y === 0)!;
  for (let y = 0; y <= 32; y++)
    expect(c.heights[y * 33 + 32]).toBe(right.heights[y * 33]);
  expect(terrainReader(b, [...b.chunks].reverse()).height(-0.5, 0.5)).toBe(
    read.height(-0.5, 0.5),
  );
  expect(decodeChunk(c.x, c.y, encodeChunk(c), c.hash)).toEqual(c);
  expect(() => decodeChunk(0, 0, Buffer.alloc(3202), c.hash)).toThrow();
  expect(
    readFoundingWorld(
      worldHeader(b, {
        id: "a",
        name: "a",
        source: "creator",
        purpose: "active",
        createdAt: "now",
      }),
    ).baseline.hash,
  ).toBe(b.hash);
  expect(() => readFoundingWorld({ schemaVersion: 3 })).toThrow();
});
it("proves founding support, two exits and capacity; blocks footprint and steep/wet cells independently of art", () => {
  const b = generateBaseline("dry-test"),
    s = foundingStructure(),
    active = { centerX: 0, centerY: 0, radius: 32, version: 1 as const };
  expect(validateSite(b, b.chunks, s)).toBe(true);
  expect(halfClaims(s)).toHaveLength(24);
  const g = walkGrid(b, b.chunks, active, [s]);
  expect(
    reachable(g, s.entrance, [
      { x: -20, y: 0 },
      { x: 0, y: -20 },
    ]),
  ).toBe(true);
  expect(reachable(g, s.entrance, [{ x: 0, y: 0 }])).toBe(false);
  expect(halfClaims({ x: -0.5, y: -0.5, width: 1, depth: 1 })).toEqual([
    "-1,-1",
    "0,-1",
    "-1,0",
    "0,0",
  ]);
  expect(() => halfClaims({ x: 0.1, y: 0, width: 1, depth: 1 })).toThrow();
  expect(b.certificate.opportunities).toBe(8);
});

it("keeps every shared chunk border exact and activation independent of saved geography", () => {
  const b = generateBaseline("seams"),
    map = new Map(b.chunks.map((c) => [`${c.x},${c.y}`, c]));
  const before = b.chunks.map((c) => encodeChunk(c).toString("hex"));
  for (const c of b.chunks) {
    const east = map.get(`${c.x + 1},${c.y}`),
      south = map.get(`${c.x},${c.y + 1}`);
    for (let i = 0; i <= 32; i++) {
      if (east) expect(c.heights[i * 33 + 32]).toBe(east.heights[i * 33]);
      if (south) expect(c.heights[32 * 33 + i]).toBe(south.heights[i]);
    }
  }
  const w = worldHeader(b, {
    id: "activation-fixture",
    name: "fixture",
    createdAt: "fixed",
    source: "showcase",
    purpose: "development",
  });
  w.active.radius = 40;
  expect(w.baseline.hash).toBe(b.hash);
  expect(b.chunks.map((c) => encodeChunk(c).toString("hex"))).toEqual(before);
});

it("canonical geographic descriptor survives JSONB key order and chunk loading order without changing saved hashes", () => {
  const b = generateBaseline("fern");
  const sortObject = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sortObject)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sortObject(v)]),
          )
        : value;
  const roundTrip = sortObject(b) as typeof b;
  roundTrip.chunks.reverse();
  expect(baselineDigest(roundTrip)).toBe(b.hash);
});
