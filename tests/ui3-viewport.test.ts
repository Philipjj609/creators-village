import { expect, it } from "vitest";
import {
  clampCameraTranslation,
  terrainWindow,
} from "../packages/renderer/src/viewport-bounds.js";
it("keeps the viewport inside large projected bounds at all pan extremes", () => {
  const b = { x: -4200, y: -2400, width: 8400, height: 4800 };
  for (const [w, h] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
    [2560, 720],
  ])
    for (const s of [0.6, 1, 2.6])
      for (const x of [-1e5, 0, 1e5])
        for (const y of [-1e5, 0, 1e5]) {
          const p = clampCameraTranslation(x!, y!, s!, w!, h!, b);
          expect(p.x + b.x * s!).toBeLessThanOrEqual(0.001);
          expect(p.x + (b.x + b.width) * s!).toBeGreaterThanOrEqual(w! - 0.001);
          expect(p.y + b.y * s!).toBeLessThanOrEqual(0.001);
          expect(p.y + (b.y + b.height) * s!).toBeGreaterThanOrEqual(
            h! - 0.001,
          );
        }
});
it("centers a finite legacy world instead of letting it disappear offscreen", () => {
  expect(
    clampCameraTranslation(-1e4, 1e4, 0.2, 1440, 1000, {
      x: -1000,
      y: -550,
      width: 2000,
      height: 1100,
    }),
  ).toEqual({ x: 720, y: 500 });
});
it("streams every visible corner beyond the old logical center clamp, within saved chunk bounds", () => {
  const b = { min: -256, size: 512, chunkSize: 32 };
  for (const [w, h] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
    [2560, 720],
  ])
    for (const s of [0.5, 1, 2.6])
      for (const cx of [-3000, 0, 3000])
        for (const cy of [-1500, 0, 1500]) {
          const win = terrainWindow(w!, h!, cx, cy, s, b);
          expect(win.x0).toBeGreaterThanOrEqual(-8);
          expect(win.x1).toBeLessThanOrEqual(7);
          expect(win.y0).toBeGreaterThanOrEqual(-8);
          expect(win.y1).toBeLessThanOrEqual(7);
          for (const [sx, sy] of [
            [0, 0],
            [w!, 0],
            [0, h!],
            [w!, h!],
          ]) {
            const px = (sx! - cx) / s,
              py = (sy! - cy) / s,
              x = px / 64 + py / 32,
              y = py / 32 - px / 64;
            if (x >= -256 && x < 256 && y >= -256 && y < 256) {
              expect(Math.floor(x / 32)).toBeGreaterThanOrEqual(win.x0);
              expect(Math.floor(x / 32)).toBeLessThanOrEqual(win.x1);
              expect(Math.floor(y / 32)).toBeGreaterThanOrEqual(win.y0);
              expect(Math.floor(y / 32)).toBeLessThanOrEqual(win.y1);
            }
          }
        }
  expect(terrainWindow(1440, 1000, -2000, -1200, 1, b).centerX).toBeGreaterThan(
    48,
  );
});
