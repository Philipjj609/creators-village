import { it, expect } from "vitest";
import {
  generateBaseline,
  worldHeader,
} from "../packages/world/src/founding.js";
import {
  planResidentGoals,
  residentDecisionLedger,
  evaluateResidents,
  RESIDENT_SHIFT_MS,
} from "../packages/world/src/living.js";
import {
  terrainReader,
  contains,
} from "../packages/world/src/founding-spatial.js";
const b = generateBaseline("fern"),
  w = worldHeader(b, {
    id: "synthetic-lw11",
    name: "Synthetic",
    createdAt: "2026-01-01",
    source: "showcase",
    purpose: "active",
  });
const places = [
  {
    id: w.structure.id,
    template: w.structure.template,
    entrance: w.structure.entrance,
  },
];
const make = () =>
  planResidentGoals(w, b.chunks, [w.structure], places, Date.UTC(2026, 9, 31));
const epoch = Date.UTC(2026, 0, 1);
it("selects deterministic role/time/motivation goals, with bounded serialized state", () => {
  const a = make(),
    c = make();
  expect(a).toEqual(c);
  expect(JSON.stringify(a).length).toBeLessThan(128 * 1024);
  expect(evaluateResidents(a, epoch + 40000)).toEqual(
    evaluateResidents(JSON.parse(JSON.stringify(c)), epoch + 40000),
  );
  const sequences = new Set(
    Array.from({ length: 30 }, (_, s) =>
      residentDecisionLedger(a, s)[0]!
        .map((x) => x.goal.id)
        .join(","),
    ),
  );
  expect(sequences.size).toBeGreaterThan(1);
  expect(residentDecisionLedger(a, 12)[0]!.map((x) => x.perform)).not.toEqual(
    residentDecisionLedger(a, 12)[3]!.map((x) => x.perform),
  );
  expect(JSON.stringify(a)).not.toMatch(/twitch|subject|token|memberId/i);
});
it("arrives, faces its subject, performs for its duration, completes, and reevaluates", () => {
  const p = make(),
    ledger = residentDecisionLedger(p, 12),
    shift = epoch + 12 * RESIDENT_SHIFT_MS;
  for (let i = 0; i < 4; i++)
    for (const a of ledger[i]!) {
      expect(a.perform - a.arrival).toBeGreaterThanOrEqual(1400);
      expect(a.complete - a.end).toBe(1200);
      expect(evaluateResidents(p, shift + a.start + 1)[i]!.actionPhase).toBe(
        "choosing",
      );
      const acting = evaluateResidents(p, shift + a.perform + 1)[i]!;
      expect(acting.actionPhase).toBe("performing");
      expect(acting.goalId).toBe(a.goal.id);
      expect(acting.position).toEqual(a.route.at(-1));
      expect(acting.direction).toEqual({
        x: a.goal.face.x - acting.position.x,
        y: a.goal.face.y - acting.position.y,
      });
      expect(evaluateResidents(p, shift + a.end + 1)[i]!.actionPhase).toBe(
        "complete",
      );
    }
});
it("coordinates both partners at reachable distinct positions with a common conversation interval", () => {
  const p = make();
  for (const s of [0, 12, 10000])
    for (const [a, b] of [
      [0, 1],
      [2, 3],
    ]) {
      const ledgers = residentDecisionLedger(p, s),
        x = ledgers[a!]!.find((a) => a.goal.id === "social")!,
        y = ledgers[b!]!.find((a) => a.goal.id === "social")!;
      expect(x.perform).toBe(y.perform);
      expect(x.end).toBe(y.end);
      expect(x.end - x.perform).toBe(24000);
      const states = evaluateResidents(
        p,
        epoch + s * RESIDENT_SHIFT_MS + x.perform + 500,
      );
      expect(states[a!]!.partnerId).toBe(states[b!]!.id);
      expect(states[b!]!.partnerId).toBe(states[a!]!.id);
      expect(states[a!]!.activity).toBe("gather");
      expect(states[b!]!.activity).toBe("gather");
      expect(states[a!]!.position).not.toEqual(states[b!]!.position);
      expect(states[a!]!.direction.x).toBeCloseTo(-states[b!]!.direction.x);
      expect(states[a!]!.direction.y).toBeCloseTo(-states[b!]!.direction.y);
    }
});
it("uses only reachable terrain/interaction positions and cardinal routes outside protected footprints", () => {
  const blocked = { x: -1, y: 4, width: 2, depth: 2 };
  const p = planResidentGoals(w, b.chunks, [w.structure, blocked], places, 0),
    read = terrainReader(w.baseline, b.chunks);
  for (const r of p.residents)
    for (const route of r.routes!)
      for (let i = 0; i < route.points.length; i++) {
        const a = route.points[Math.max(0, i - 1)]!,
          z = route.points[i]!;
        expect(Math.abs(a.x - z.x) + Math.abs(a.y - z.y)).toBeLessThanOrEqual(
          0.5,
        );
        for (let f = 0; f <= 1; f += 0.125) {
          const x = a.x + (z.x - a.x) * f,
            y = a.y + (z.y - a.y) * f;
          expect(read.cell(x, y) & 7).toBe(0);
          expect(contains(blocked, x, y) || contains(w.structure, x, y)).toBe(
            false,
          );
        }
      }
});
it("chooses workshop work only from an existing reachable workshop", () => {
  const first = make();
  expect(JSON.stringify(first)).not.toContain("Mending Shed");
  const workshop = { x: 4, y: 2, width: 6, depth: 6 };
  const p = planResidentGoals(
    w,
    b.chunks,
    [w.structure, workshop],
    [
      ...places,
      {
        id: "saved-workshop",
        template: "wf2-workshop-1",
        entrance: { x: 7, y: 8.75 },
      },
    ],
    0,
  );
  expect(p.residents[2]!.goals!.find((g) => g.id === "work")!.structureId).toBe(
    "saved-workshop",
  );
  expect(
    first.residents[2]!.goals!.find((g) => g.id === "work")!.structureId,
  ).toBe(w.structure.id);
  const inaccessible = planResidentGoals(
    w,
    b.chunks,
    [w.structure, { x: 4, y: 2, width: 12, depth: 12 }],
    [
      ...places,
      {
        id: "saved-workshop",
        template: "wf2-workshop-1",
        entrance: { x: 7, y: 8.75 },
      },
    ],
    0,
  );
  expect(inaccessible.residents[2]!.goals!.some((g) => g.id === "work")).toBe(
    false,
  );
});
it("reconstructs long offline time and returns continuously across shift boundaries", () => {
  const p = make(),
    future = epoch + 100 * 365.25 * 86400000;
  expect(evaluateResidents(p, future)).toEqual(
    evaluateResidents(JSON.parse(JSON.stringify(p)), future),
  );
  for (let s = 0; s < 20; s++) {
    const t = epoch + (s + 1) * RESIDENT_SHIFT_MS;
    const before = evaluateResidents(p, t - 0.001),
      after = evaluateResidents(p, t);
    before.forEach((x, i) => expect(x.position).toEqual(after[i]!.position));
    expect(
      residentDecisionLedger(p, s).every(
        (a) => a.length <= 18 && a.at(-1)!.complete === RESIDENT_SHIFT_MS,
      ),
    ).toBe(true);
  }
  const normal = evaluateResidents(p, epoch + 12345),
    reduced = evaluateResidents(p, epoch + 12345, true);
  normal.forEach((s, i) => expect(s.actionPhase).toBe(reduced[i]!.actionPhase));
});
