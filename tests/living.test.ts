import { describe, it, expect } from "vitest";
import {
  generateBaseline,
  worldHeader,
} from "../packages/world/src/founding.js";
import {
  planResidents,
  evaluateResidents,
} from "../packages/world/src/living.js";
import {
  terrainReader,
  contains,
  type Rect,
} from "../packages/world/src/founding-spatial.js";
import type { LivingVillage } from "@creators-village/contracts";

const baseline = generateBaseline("fern");
const world = worldHeader(baseline, {
  id: "synthetic-lw1",
  name: "Synthetic clearing",
  createdAt: "2026-10-31T00:00:00Z",
  source: "creator",
  purpose: "development",
});
const places = [
  {
    id: world.structure.id,
    template: world.structure.template,
    entrance: world.structure.entrance,
  },
];
const time = Date.UTC(2026, 9, 31, 12);
const build = (solids: Rect[] = [world.structure], p = places) =>
  planResidents(world, baseline.chunks, solids, p, time);

describe("LW1 deterministic fictional inhabitants", () => {
  it("reconstructs the same world and instant, independent of snapshot time, with stable scoped IDs", () => {
    const a = build(),
      b = build();
    expect(a).toEqual(b);
    expect(a.residents).toHaveLength(4);
    expect(new Set(a.residents.map((r) => r.id)).size).toBe(4);
    expect(evaluateResidents(a, time)).toEqual(
      evaluateResidents({ ...b, serverTimeMs: time + 86400000 }, time),
    );
    expect(JSON.stringify(a)).not.toMatch(
      /twitch|personId|memberId|subject|contribution|token/i,
    );
    expect(
      a.residents.every(
        (r) => r.fictional && r.id.startsWith(world.id + ":lw1:"),
      ),
    ).toBe(true);
    expect(
      planResidents(
        { ...world, id: "other" },
        baseline.chunks,
        [world.structure],
        places,
        time,
      ).residents.map((r) => r.id),
    ).not.toEqual(a.residents.map((r) => r.id));
  });
  function verify(plan: LivingVillage, solids: Rect[]) {
    const read = terrainReader(world.baseline, baseline.chunks);
    for (const r of plan.residents)
      for (let k = 0; k < r.stops.length; k++) {
        const stop = r.stops[k]!,
          previous = r.stops[(k + r.stops.length - 1) % r.stops.length]!;
        expect(stop.route[0]).toEqual(previous.route.at(-1));
        for (let i = 0; i < stop.route.length; i++) {
          const a = stop.route[Math.max(0, i - 1)]!,
            b = stop.route[i]!;
          expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThanOrEqual(
            0.5,
          );
          for (let t = 0; t <= 1; t += 0.125) {
            const x = a.x + (b.x - a.x) * t,
              y = a.y + (b.y - a.y) * t;
            expect(read.cell(x, y) & 7).toBe(0);
            expect(Math.hypot(x, y)).toBeLessThan(world.active.radius);
            expect(solids.some((s) => contains(s, x, y))).toBe(false);
          }
        }
      }
  }
  it("routes around occupied footprints and protected claims without diagonal corner cuts", () => {
    const protectedClaim = { x: -1, y: 4, width: 2, depth: 3 };
    verify(build([world.structure, protectedClaim]), [
      world.structure,
      protectedClaim,
    ]);
    expect(build([world.structure, protectedClaim]).residents).not.toEqual(
      build().residents,
    );
  });
  it("only assigns a reachable workshop after the structure exists, then adapts without changing terrain", () => {
    expect(JSON.stringify(build())).not.toContain("Mending Shed entrance");
    const workshop = { x: 4, y: 2, width: 6, depth: 6 };
    const p = [
      ...places,
      {
        id: "saved-workshop",
        template: "wf2-workshop-1",
        entrance: { x: 7, y: 8.75 },
      },
    ];
    const next = build([world.structure, workshop], p);
    expect(next.residents[2]!.stops[1]!.structureId).toBe("saved-workshop");
    verify(next, [world.structure, workshop]);
    expect(next.baselineHash).toBe(build().baselineHash);
    // Physically unreachable destination must not be described as a workplace.
    const blocked = build(
      [world.structure, { x: 4, y: 2, width: 10, depth: 12 }],
      p,
    );
    expect(blocked.residents[2]!.stops[1]!.structureId).toBeNull();
  });
  it("evaluates exact transitions, all five activities, long offline periods and reduced motion", () => {
    const plan = build(),
      activities = new Set<string>();
    for (let dt = 0; dt < 300000; dt += 500) {
      const states = evaluateResidents(plan, time + dt);
      states.forEach((s) => activities.add(s.activity));
      const reduced = evaluateResidents(plan, time + dt, true);
      reduced.forEach((s, i) => {
        expect(s.activity).toBe(states[i]!.activity);
        expect(Number.isFinite(s.position.height)).toBe(true);
      });
    }
    expect([...activities].sort()).toEqual([
      "gather",
      "idle",
      "rest",
      "travel",
      "work",
    ]);
    expect(evaluateResidents(plan, time + 100 * 365.25 * 86400000)).toEqual(
      evaluateResidents(
        JSON.parse(JSON.stringify(plan)),
        time + 100 * 365.25 * 86400000,
      ),
    );
    for (const r of plan.residents) {
      const first = r.stops[0]!,
        duration = (first.route.length - 1) * 1000;
      const t = Date.UTC(2026, 0, 1) - r.phaseMs;
      const at = evaluateResidents(
        { ...plan, residents: [r] },
        t + duration,
      )[0]!;
      expect(at.activity).toBe(first.activity);
      expect(at.position).toEqual(first.route.at(-1));
    }
  });
  it("fails closed to no residents when terrain is missing or all space is protected", () => {
    expect(
      planResidents(world, [], [world.structure], places, time).residents,
    ).toEqual([]);
    expect(
      build([{ x: -64, y: -64, width: 128, depth: 128 }]).residents,
    ).toEqual([]);
    expect(() =>
      evaluateResidents(
        { ...build(), rules: "future" } as unknown as LivingVillage,
        time,
      ),
    ).toThrow();
  });
});
