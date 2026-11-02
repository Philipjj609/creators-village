/** Presentation-only terrain contract. Coordinates, cell flags and Q16 corner heights remain authoritative. */
export const TERRAIN_STYLE = {
  version: "cv-artlab-ap4-terrain-01",
  waterLevel: 0.5,
  missingCell: 255,
  bankColor: 0x88927b,
} as const;
export type TerrainMaterialSample = {
  x: number;
  y: number;
  flags: number;
  slope: number;
  waterNeighbors: number;
};
/** Incoming versioned material atlas should replace these colors, not classification or geometry. */
export function terrainMaterial({
  x,
  y,
  flags,
  slope,
  waterNeighbors,
}: TerrainMaterialSample) {
  const wet = (flags & 1) !== 0;
  const variation = Math.round(
    (Math.sin(x * 0.19 + Math.sin(y * 0.13)) + Math.sin(y * 0.23)) * 1.5,
  );
  const base = wet
    ? waterNeighbors < 4
      ? 0x7da7a4
      : 0x709fa2
    : flags & (8 | 2)
      ? 0x819777
      : 0xa4ae84;
  return (
    base +
    Math.max(-8, Math.min(9, Math.round(slope * 9) + variation)) * 0x010101
  );
}
export function coastEdges(
  x: number,
  y: number,
  cell: (x: number, y: number) => number,
) {
  if (cell(x, y) === 255 || cell(x, y) & 1) return [];
  return [
    {
      neighbor: [x, y - 1],
      corners: [
        [0, 0],
        [1, 0],
      ],
    },
    {
      neighbor: [x + 1, y],
      corners: [
        [1, 0],
        [1, 1],
      ],
    },
    {
      neighbor: [x, y + 1],
      corners: [
        [1, 1],
        [0, 1],
      ],
    },
    {
      neighbor: [x - 1, y],
      corners: [
        [0, 1],
        [0, 0],
      ],
    },
  ].filter((e) => {
    const f = cell(e.neighbor[0]!, e.neighbor[1]!);
    return f !== 255 && !!(f & 1);
  });
}
