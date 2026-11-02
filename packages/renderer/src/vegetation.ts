/** Presentation profiles in original logical units. Anchors and persisted feature placement stay fixed. */
export const VEGETATION_SCALE: Readonly<Record<string, number>> = {
  "oak-round": 1.2,
  "oak-tall": 1.4,
  "oak-wide": 1.25,
  "oak-young": 0.95,
  "oak-old": 1.45,
  "oak-round-autumn": 1.2,
  "oak-wide-autumn": 1.25,
  "oak-twin": 1.25,
  "pine-small": 0.95,
  "pine-tall": 1.2,
  blossom: 0.9,
};
export const vegetationScale = (id: string) => VEGETATION_SCALE[id] ?? 1;
