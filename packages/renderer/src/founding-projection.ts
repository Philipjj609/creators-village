import type { terrainReader } from "@creators-village/world/spatial";
export const terrainProject = (x: number, y: number, z: number) => ({
  x: (x - y) * 32,
  y: (x + y) * 16 - z * 32 * Math.sqrt(1.5),
});
/** Exact projected-triangle picking for the bounded gentle heightfield, not bridges/cliffs. */
export function pickGround(
  px: number,
  py: number,
  read: ReturnType<typeof terrainReader>,
) {
  const fx = px / 64 + py / 32,
    fy = py / 32 - px / 64;
  let best: {
    x: number;
    y: number;
    height: number;
    cellX: number;
    cellY: number;
    flags: number;
  } | null = null;
  // This profile bounds heights to [-.5,2.5]; conservative +/-6 logical units.
  for (let y = Math.floor(fy) - 8; y <= Math.floor(fy) + 8; y++)
    for (let x = Math.floor(fx) - 8; x <= Math.floor(fx) + 8; x++) {
      const corners = read.corners(x, y);
      if (!corners) continue;
      const flags = read.cell(x, y),
        wet = (flags & 1) !== 0;
      const v = [
        { x, y, z: wet ? 0.5 : corners[0]! / 16 },
        { x: x + 1, y, z: wet ? 0.5 : corners[1]! / 16 },
        { x, y: y + 1, z: wet ? 0.5 : corners[2]! / 16 },
        { x: x + 1, y: y + 1, z: wet ? 0.5 : corners[3]! / 16 },
      ];
      for (const indices of [
        [0, 1, 3],
        [0, 3, 2],
      ]) {
        const [a, b, c] = indices.map((i) => v[i]!) as [
          (typeof v)[number],
          (typeof v)[number],
          (typeof v)[number],
        ];
        const p = terrainProject(a.x, a.y, a.z),
          q = terrainProject(b.x, b.y, b.z),
          r = terrainProject(c.x, c.y, c.z),
          den = (q.y - r.y) * (p.x - r.x) + (r.x - q.x) * (p.y - r.y);
        if (Math.abs(den) < 1e-6) continue;
        const u = ((q.y - r.y) * (px - r.x) + (r.x - q.x) * (py - r.y)) / den,
          w = ((r.y - p.y) * (px - r.x) + (p.x - r.x) * (py - r.y)) / den,
          t = 1 - u - w;
        if (Math.min(u, w, t) < -1e-6) continue;
        const hit = {
          x: u * a.x + w * b.x + t * c.x,
          y: u * a.y + w * b.y + t * c.y,
          height: u * a.z + w * b.z + t * c.z,
          cellX: x,
          cellY: y,
          flags,
        };
        if (!best || hit.x + hit.y > best.x + best.y) best = hit;
      }
    }
  return best;
}
