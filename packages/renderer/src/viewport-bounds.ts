/** Geometry-only viewport helpers. No terrain is synthesized or extended. */
export function clampCameraTranslation(
  x: number,
  y: number,
  scale: number,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const axis = (value: number, screen: number, start: number, size: number) =>
    size * scale <= screen
      ? (screen - size * scale) / 2 - start * scale
      : Math.max(
          screen - (start + size) * scale,
          Math.min(value, -start * scale),
        );
  return {
    x: axis(x, width, bounds.x, bounds.width),
    y: axis(y, height, bounds.y, bounds.height),
  };
}
/** Inverse orthographic XY over the whole visible screen, plus bounded height guard. */
export function terrainWindow(
  width: number,
  height: number,
  x: number,
  y: number,
  scale: number,
  baseline: { min: number; size: number; chunkSize: number },
) {
  const points = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([sx, sy]) => {
    const px = (sx! - x) / scale,
      py = (sy! - y) / scale;
    return { x: px / 64 + py / 32, y: py / 32 - px / 64 };
  });
  const centerX = (width / 2 - x) / scale / 64 + (height / 2 - y) / scale / 32;
  const centerY = (height / 2 - y) / scale / 32 - (width / 2 - x) / scale / 64;
  const first = Math.floor(baseline.min / baseline.chunkSize),
    last = Math.floor((baseline.min + baseline.size - 1) / baseline.chunkSize);
  const lo = (values: number[]) =>
    Math.max(
      first,
      Math.floor((Math.min(...values) - 10) / baseline.chunkSize),
    );
  const hi = (values: number[]) =>
    Math.min(last, Math.floor((Math.max(...values) + 10) / baseline.chunkSize));
  return {
    cells: {
      x0: Math.max(
        baseline.min,
        Math.floor((Math.min(...points.map((p) => p.x)) - 10) / 8) * 8,
      ),
      x1: Math.min(
        baseline.min + baseline.size,
        Math.ceil((Math.max(...points.map((p) => p.x)) + 10) / 8) * 8,
      ),
      y0: Math.max(
        baseline.min,
        Math.floor((Math.min(...points.map((p) => p.y)) - 10) / 8) * 8,
      ),
      y1: Math.min(
        baseline.min + baseline.size,
        Math.ceil((Math.max(...points.map((p) => p.y)) + 10) / 8) * 8,
      ),
    },
    centerX,
    centerY,
    radius:
      Math.max(
        ...points.map((p) =>
          Math.max(Math.abs(p.x - centerX), Math.abs(p.y - centerY)),
        ),
      ) + 10,
    x0: lo(points.map((p) => p.x)),
    x1: hi(points.map((p) => p.x)),
    y0: lo(points.map((p) => p.y)),
    y1: hi(points.map((p) => p.y)),
  };
}
