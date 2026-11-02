export function snappedSite(x: number, y: number) {
  const snap = (n: number) =>
    Math.max(-65536, Math.min(65536, Math.round(n * 2) * 128));
  return { qx: snap(x), qy: snap(y) };
}
