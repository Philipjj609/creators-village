import type {
  FoundingBaseline,
  FoundingWorld,
  TerrainChunk,
  FoundingStructure,
} from "@creators-village/contracts";
export const WATER = 1,
  TREE = 2,
  ROCK = 4;
export function chunkKey(x: number, y: number) {
  return `${x},${y}`;
}
export function terrainReader(
  b: Pick<FoundingBaseline, "min" | "size" | "chunkSize">,
  chunks: TerrainChunk[],
) {
  const map = new Map(chunks.map((c) => [chunkKey(c.x, c.y), c]));
  const n = b.chunkSize;
  function at(x: number, y: number) {
    const cx = Math.floor(x / n),
      cy = Math.floor(y / n);
    return { c: map.get(chunkKey(cx, cy)), lx: x - cx * n, ly: y - cy * n };
  }
  return {
    cell(x: number, y: number) {
      const { c, lx, ly } = at(Math.floor(x), Math.floor(y));
      return c?.cells[ly * n + lx] ?? 255;
    },
    height(x: number, y: number) {
      // Canonical NW-SE triangle split. Integer corners, piecewise-linear presentation.
      const ix = Math.floor(x),
        iy = Math.floor(y),
        { c, lx, ly } = at(ix, iy);
      if (!c) return null;
      const h = (dx: number, dy: number) =>
        c.heights[(ly + dy) * (n + 1) + lx + dx]! / 16;
      const u = x - ix,
        v = y - iy,
        a = h(0, 0),
        d = h(1, 1);
      return u >= v
        ? a + (h(1, 0) - a) * u + (d - h(1, 0)) * v
        : a + (d - h(0, 1)) * u + (h(0, 1) - a) * v;
    },
    corners(x: number, y: number) {
      const { c, lx, ly } = at(x, y);
      return c
        ? [
            c.heights[ly * (n + 1) + lx]!,
            c.heights[ly * (n + 1) + lx + 1]!,
            c.heights[(ly + 1) * (n + 1) + lx]!,
            c.heights[(ly + 1) * (n + 1) + lx + 1]!,
          ]
        : null;
    },
  };
}
export type Rect = { x: number; y: number; width: number; depth: number };
export function contains(r: Rect, x: number, y: number) {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.depth;
}
export function halfClaims(r: Rect) {
  if (
    ![r.x, r.y, r.width, r.depth].every((v) => Number.isSafeInteger(v * 2)) ||
    r.width <= 0 ||
    r.depth <= 0
  )
    throw Error("Invalid half-cell footprint");
  const out: string[] = [];
  for (let y = r.y * 2; y < (r.y + r.depth) * 2; y++)
    for (let x = r.x * 2; x < (r.x + r.width) * 2; x++) out.push(`${x},${y}`);
  return out;
}
export function walkGrid(
  b: Pick<FoundingBaseline, "min" | "size" | "chunkSize">,
  chunks: TerrainChunk[],
  active: FoundingWorld["active"],
  solids: Rect[] = [],
) {
  const read = terrainReader(b, chunks),
    min = -active.radius * 2,
    n = active.radius * 4,
    grid = new Uint8Array(n * n);
  for (let yy = 0; yy < n; yy++)
    for (let xx = 0; xx < n; xx++) {
      const x = (xx + min + 0.5) / 2,
        y = (yy + min + 0.5) / 2;
      const h = read.corners(Math.floor(x), Math.floor(y));
      const valid =
        (x - active.centerX) ** 2 + (y - active.centerY) ** 2 <
          active.radius ** 2 &&
        !(read.cell(x, y) & (WATER | TREE | ROCK)) &&
        h &&
        Math.max(...h) - Math.min(...h) <= 4 &&
        !solids.some((r) => contains(r, x, y));
      grid[yy * n + xx] = valid ? 1 : 0;
    }
  return { grid, min, n };
}
export function reachable(
  g: ReturnType<typeof walkGrid>,
  start: { x: number; y: number },
  goals: { x: number; y: number }[],
) {
  const index = (p: { x: number; y: number }) => {
    const x = Math.floor(p.x * 2) - g.min,
      y = Math.floor(p.y * 2) - g.min;
    return x < 0 || y < 0 || x >= g.n || y >= g.n ? -1 : y * g.n + x;
  };
  const s = index(start);
  if (s < 0 || !g.grid[s]) return false;
  const seen = new Uint8Array(g.grid.length),
    q = new Int32Array(g.grid.length);
  let a = 0,
    z = 1;
  q[0] = s;
  seen[s] = 1;
  while (a < z) {
    const i = q[a++]!,
      x = i % g.n;
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < g.n - 1 ? i + 1 : -1,
      i - g.n,
      i + g.n,
    ])
      if (j >= 0 && j < g.grid.length && g.grid[j] && !seen[j]) {
        seen[j] = 1;
        q[z++] = j;
      }
  }
  return goals.every((p) => {
    const i = index(p);
    return i >= 0 && seen[i] === 1;
  });
}
export function foundingStructure(): FoundingStructure {
  return {
    id: "founding-shelter",
    template: "gathering-shelter-1",
    name: "The Gathering Shelter",
    x: -1.5,
    y: -1,
    width: 3,
    depth: 2,
    entrance: { x: 0, y: 1.5 },
    height: 1,
    appearance: "hearthside-hero-01/commons",
  };
}
export function validateSite(
  b: FoundingBaseline,
  chunks: TerrainChunk[],
  r: Rect,
) {
  const read = terrainReader(b, chunks);
  let min = Infinity,
    max = -Infinity;
  for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.depth); y++)
    for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.width); x++) {
      if (read.cell(x, y) & 7) return false;
      const h = read.corners(x, y);
      if (!h) return false;
      min = Math.min(min, ...h);
      max = Math.max(max, ...h);
    }
  return max - min <= 4;
}
