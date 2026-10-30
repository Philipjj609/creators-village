export const UNITS_PER_TILE = 256;
export const CHUNK_TILES = 32;
export const chunkOf = (coordinate: number): number =>
  Math.floor(coordinate / (UNITS_PER_TILE * CHUNK_TILES));
export function quantize(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
    throw new Error("Coordinate outside supported bounds");
  return Math.round(value * UNITS_PER_TILE);
}
export function project(
  x: number,
  y: number,
  elevation = 0,
): { x: number; y: number } {
  return { x: (x - y) * 32, y: (x + y) * 16 - elevation * 8 };
}
export function unproject(
  x: number,
  y: number,
  elevation = 0,
): { x: number; y: number } {
  const groundY = y + elevation * 8;
  return { x: x / 64 + groundY / 32, y: groundY / 32 - x / 64 };
}
export function overlaps(
  a: { x: number; y: number; width: number; depth: number },
  b: { x: number; y: number; width: number; depth: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.depth &&
    a.y + a.depth > b.y
  );
}
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
