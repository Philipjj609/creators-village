import {
  LIVING_RULES,
  type FoundingWorld,
  type TerrainChunk,
  type LivingVillage,
  type ResidentState,
  type ResidentPoint,
  type ResidentStop,
} from "@creators-village/contracts";
import { walkGrid, terrainReader, type Rect } from "./founding-spatial.js";
import { evaluateGoalResidents } from "./living-goals.js";
export {
  planResidentGoals,
  residentDecisionLedger,
  RESIDENT_SHIFT_MS,
} from "./living-goals.js";

type Place = {
  id: string;
  template: string;
  entrance: { x: number; y: number };
};
const EPOCH = Date.UTC(2026, 0, 1);
const PEOPLE = [
  ["mira", "Mira Fen", "Path keeper", 0xd49b57],
  ["oren", "Oren Reed", "Gathering steward", 0x769f9a],
  ["nell", "Nell Bramble", "Mender", 0xb57987],
  ["ivo", "Ivo Moss", "Field tender", 0x8b9271],
] as const;

/** Bounded pure reconstruction from a coherent authoritative spatial snapshot. */
export function planResidents(
  world: FoundingWorld,
  chunks: TerrainChunk[],
  solids: Rect[],
  places: Place[],
  serverTimeMs: number,
): LivingVillage {
  // 0.12 logical radius prevents the visible body entering adjacent claims.
  const g = walkGrid(
    world.baseline,
    chunks,
    world.active,
    solids.map((r) => ({
      x: r.x - 0.12,
      y: r.y - 0.12,
      width: r.width + 0.24,
      depth: r.depth + 0.24,
    })),
  );
  const read = terrainReader(world.baseline, chunks);
  const point = (i: number): ResidentPoint => {
    const x = ((i % g.n) + g.min + 0.5) / 2;
    const y = (Math.floor(i / g.n) + g.min + 0.5) / 2;
    return { x, y, height: read.height(x, y)! };
  };
  const neighbours = (i: number) =>
    [
      i % g.n > 0 ? i - 1 : -1,
      i % g.n < g.n - 1 ? i + 1 : -1,
      i - g.n,
      i + g.n,
    ].filter((j) => j >= 0 && j < g.grid.length && g.grid[j]);
  const nearest = (x: number, y: number, candidates: number[]) => {
    let best = -1,
      distance = Infinity;
    for (const i of candidates) {
      const p = point(i),
        d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    return best;
  };
  // Local clearing only: keep initial inhabitants readable, not scattered over the envelope.
  const all = [...g.grid.keys()].filter((i) => {
    if (!g.grid[i]) return false;
    const p = point(i);
    return (
      Math.hypot(
        p.x - world.structure.entrance.x,
        p.y - world.structure.entrance.y,
      ) <= 14
    );
  });
  const root = nearest(
    world.structure.entrance.x,
    world.structure.entrance.y,
    all,
  );
  const reachable: number[] = [];
  if (root >= 0) {
    const seen = new Set([root]),
      queue = [root];
    for (let a = 0; a < queue.length; a++) {
      const i = queue[a]!;
      reachable.push(i);
      for (const j of neighbours(i))
        if (!seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
    }
  }
  const route = (start: number, end: number) => {
    const parent = new Int32Array(g.grid.length).fill(-1),
      queue = [start];
    parent[start] = start;
    for (let a = 0; a < queue.length && parent[end] === -1; a++) {
      const i = queue[a]!;
      for (const j of neighbours(i))
        if (parent[j] === -1) {
          parent[j] = i;
          queue.push(j);
        }
    }
    const out = [end];
    while (out[out.length - 1] !== start)
      out.push(parent[out[out.length - 1]!]!);
    return out.reverse().map(point);
  };
  const shelter = places.find((p) => p.id === world.structure.id);
  const workshop = places.find((p) => p.template === "wf2-workshop-1");
  const result: LivingVillage = {
    rules: LIVING_RULES,
    worldId: world.id,
    baselineHash: world.baseline.hash,
    topologyEpoch: world.topologyEpoch,
    serverTimeMs,
    stepMs: 1000,
    residents: [],
  };
  if (!reachable.length) return result;
  result.residents = PEOPLE.map(([slug, name, role, color], index) => {
    const home = nearest(-3 + index * 1.5, 4 + (index % 2), reachable);
    const gather = nearest(
      index % 2 ? 2.5 : -2.5,
      2 + Math.floor(index / 2),
      reachable,
    );
    const work = nearest(
      index === 2 && workshop ? workshop.entrance.x : -4 + index * 3,
      index === 2 && workshop ? workshop.entrance.y : 8,
      reachable,
    );
    const workPoint = point(work);
    const gatherPoint = point(gather);
    const nearShelter =
      Math.hypot(
        gatherPoint.x - world.structure.entrance.x,
        gatherPoint.y - world.structure.entrance.y,
      ) < 5;
    const hasWorkshop =
      index === 2 &&
      workshop &&
      Math.hypot(
        workPoint.x - workshop.entrance.x,
        workPoint.y - workshop.entrance.y,
      ) < 2;
    const stops: {
      at: number;
      activity: ResidentStop["activity"];
      label: string;
      structureId: string | null;
      dwellMs: number;
    }[] = [
      {
        at: gather,
        activity: "gather",
        label: nearShelter
          ? "Gathering Shelter forecourt"
          : "Clearing gathering spot",
        structureId: nearShelter ? (shelter?.id ?? null) : null,
        dwellMs: 16000,
      },
      {
        at: work,
        activity: "work",
        label: hasWorkshop ? "Mending Shed entrance" : "Clearing paths",
        structureId: hasWorkshop ? workshop.id : null,
        dwellMs: 22000,
      },
      {
        at: home,
        activity: "rest",
        label: "Quiet clearing",
        structureId: null,
        dwellMs: 18000,
      },
      {
        at: home,
        activity: "idle",
        label: "Quiet clearing",
        structureId: null,
        dwellMs: 8000,
      },
    ];
    return {
      id: `${world.id}:lw1:${slug}`,
      name,
      role,
      fictional: true,
      color,
      phaseMs: index * 17000,
      stops: stops.map((s, i) => ({
        label: s.label,
        structureId: s.structureId,
        activity: s.activity,
        dwellMs: s.dwellMs,
        route: route(stops[(i + stops.length - 1) % stops.length]!.at, s.at),
      })),
    };
  });
  return result;
}

/** O(residents * fixed stops); no ticks, random values, client clock or missed-event loop. */
export function evaluateResidents(
  plan: LivingVillage,
  timeMs: number,
  reducedMotion = false,
): ResidentState[] {
  if (!Number.isFinite(timeMs)) throw Error("Unsupported living state/time");
  if (plan.rules === "lw1-goals-1")
    return evaluateGoalResidents(plan, timeMs, reducedMotion);
  if (plan.rules !== LIVING_RULES) throw Error("Unsupported living state/time");
  return plan.residents.map((r) => {
    const duration = (s: ResidentStop) => (s.route.length - 1) * plan.stepMs;
    const cycle = r.stops.reduce((n, s) => n + duration(s) + s.dwellMs, 0);
    let t = (((timeMs - EPOCH + r.phaseMs) % cycle) + cycle) % cycle;
    for (const s of r.stops) {
      const travel = duration(s);
      if (t < travel + s.dwellMs) {
        const walking = t < travel,
          step = Math.min(s.route.length - 1, Math.floor(t / plan.stepMs));
        const a = walking ? s.route[step]! : s.route.at(-1)!;
        const b = walking ? s.route[step + 1]! : a;
        const f =
          walking && !reducedMotion ? (t % plan.stepMs) / plan.stepMs : 0;
        return {
          id: r.id,
          activity: walking ? "travel" : s.activity,
          destinationActivity: s.activity,
          location: s.label,
          structureId: s.structureId,
          position: {
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            height: a.height + (b.height - a.height) * f,
          },
          direction: { x: b.x - a.x, y: b.y - a.y },
        };
      }
      t -= travel + s.dwellMs;
    }
    throw Error("Invalid resident cycle");
  });
}
