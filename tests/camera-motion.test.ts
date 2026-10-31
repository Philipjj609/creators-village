import { it, expect } from "vitest";
import {
  dampedStep,
  deadZoneTarget,
} from "../packages/renderer/src/camera-motion.js";
it("settles identically at 30,60,120 Hz without overshooting a stationary focus target", () => {
  const results = [30, 60, 120].map((hz) => {
    let value = 0,
      velocity = 0,
      previous = 0;
    for (let i = 0; i < hz; i++) {
      const s = dampedStep(value, velocity, 100, 1 / hz);
      value = s.value;
      velocity = s.velocity;
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(100);
      previous = value;
    }
    return value;
  });
  expect(results[0]).toBeCloseTo(results[1]!, 10);
  expect(results[1]).toBeCloseTo(results[2]!, 10);
  expect(results[0]).toBeGreaterThan(99.9);
});
it("accelerates and decelerates, and changes zoom smoothly in logarithmic scale", () => {
  let x = 0,
    v = 0;
  const velocities = [];
  for (let i = 0; i < 60; i++) {
    const a = dampedStep(x, v, 100, 1 / 60);
    x = a.value;
    v = a.velocity;
    velocities.push(v);
  }
  expect(velocities[0]).toBeLessThan(velocities[3]!);
  expect(velocities.at(-1)).toBeLessThan(velocities[3]!);
  const z = dampedStep(Math.log(0.5), 0, Math.log(2.2), 1 / 60);
  expect(Math.exp(z.value)).toBeGreaterThan(0.5);
  expect(Math.exp(z.value)).toBeLessThan(2.2);
});
it("keeps a stable follow dead zone and only corrects overflow", () => {
  expect(deadZoneTarget(519, 500, 36)).toBe(0);
  expect(deadZoneTarget(537, 500, 36)).toBe(1);
  expect(deadZoneTarget(460, 500, 36)).toBe(-4);
});
