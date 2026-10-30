import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
const recipe = JSON.parse(
  readFileSync("assets/source/v04-neighborhood-study-01/recipe.json", "utf8"),
);
type Point = [number, number];
// Sample the authored Catmull-Rom route, including curve overshoot and road width.
function curve(points: Point[]): Point[] {
  const samples: Point[] = [];
  for (let i = 0; i < points.length - 1; i++)
    for (let j = 0; j < 32; j++) {
      const t = j / 32,
        a = points[Math.max(0, i - 1)]!,
        b = points[i]!,
        c = points[i + 1]!,
        d = points[Math.min(points.length - 1, i + 2)]!;
      samples.push(
        [0, 1].map(
          (k) =>
            0.5 *
            (2 * b[k]! +
              (-a[k]! + c[k]!) * t +
              (2 * a[k]! - 5 * b[k]! + 4 * c[k]! - d[k]!) * t * t +
              (-a[k]! + 3 * b[k]! - 3 * c[k]! + d[k]!) * t * t * t),
        ) as Point,
      );
    }
  return [...samples, points.at(-1)!];
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
test("V04 shared street graph connects all five entrances without cutting occupied envelopes", () => {
  const roads = recipe.roads as {
    id: string;
    width: number;
    points: Point[];
  }[];
  const lines = roads.map((r) => curve(r.points));
  const reached = new Set([0]);
  for (let pass = 0; pass < roads.length; pass++)
    for (let i = 0; i < roads.length; i++)
      for (const j of reached)
        if (lines[i]!.some((a) => lines[j]!.some((b) => distance(a, b) < 0.3)))
          reached.add(i);
  expect(reached.size).toBe(roads.length);
  for (const b of recipe.buildings) {
    const entrance: Point = [
      b.position[0] + b.entrance[0],
      b.position[1] + b.entrance[1],
    ];
    expect(distance(b.route[0], entrance), b.id + " entrance").toBeLessThan(
      0.05,
    );
    const exit = b.route.at(-1) as Point;
    expect(
      Math.min(...lines.flat().map((p) => distance(p, exit))),
      b.id + " connected",
    ).toBeLessThan(0.3);
    const [fx, fy, w, h] = b.footprint;
    const x = b.position[0] + fx,
      y = b.position[1] + fy;
    for (let i = 0; i < roads.length; i++)
      for (const p of lines[i]!) {
        // The public arrival intentionally terminates at the hall threshold.
        if (
          b.id === "hall" &&
          roads[i]!.id === "public-arrival" &&
          distance(p, entrance) < 2
        )
          continue;
        const dx = Math.max(x - p[0], 0, p[0] - (x + w)),
          dy = Math.max(y - p[1], 0, p[1] - (y + h));
        expect(
          Math.hypot(dx, dy),
          `${roads[i]!.id} at ${p} clips ${b.id}`,
        ).toBeGreaterThan(roads[i]!.width / 2 - 0.05);
      }
  }
});
test("V04 homes vary structural assembly and keep water outside occupied site", () => {
  const homes = recipe.buildings.filter((b: any) => b.kind === "home");
  expect(homes).toHaveLength(3);
  expect(new Set(homes.map((b: any) => b.assembly)).size).toBe(3);
  expect(new Set(homes.map((b: any) => JSON.stringify(b.body))).size).toBe(3);
  for (const b of recipe.buildings) {
    const [x, y] = b.position,
      [fx, fy, w, h] = b.footprint;
    for (const yy of [y + fy, y + fy + h])
      expect(x + fx + w).toBeLessThan(
        15.5 + 1.35 * Math.sin(yy * 0.2 + 0.5) - 2,
      );
  }
});
