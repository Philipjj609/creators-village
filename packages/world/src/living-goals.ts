import {
  LIVING_GOAL_RULES,
  type FoundingWorld,
  type TerrainChunk,
  type LivingVillage,
  type ResidentRoutine,
  type ResidentGoal,
  type ResidentPoint,
  type ResidentState,
} from "@creators-village/contracts";
import { walkGrid, terrainReader, type Rect } from "./founding-spatial.js";

export const RESIDENT_SHIFT_MS = 240000;
const EPOCH = Date.UTC(2026, 0, 1),
  CHOOSE = 600,
  ARRIVE = 1400,
  COMPLETE = 1200;
type Place = {
  id: string;
  template: string;
  entrance: { x: number; y: number };
};
const PEOPLE = [
  ["mira", "Mira Fen", "Path keeper", 0xd49b57],
  ["oren", "Oren Reed", "Gathering steward", 0x769f9a],
  ["nell", "Nell Bramble", "Mender", 0xb57987],
  ["ivo", "Ivo Moss", "Field tender", 0x8b9271],
] as const;

export function planResidentGoals(
  world: FoundingWorld,
  chunks: TerrainChunk[],
  solids: Rect[],
  places: Place[],
  serverTimeMs: number,
): LivingVillage {
  const g = walkGrid(
    world.baseline,
    chunks,
    world.active,
    solids.map((s) => ({
      x: s.x - 0.12,
      y: s.y - 0.12,
      width: s.width + 0.24,
      depth: s.depth + 0.24,
    })),
  );
  const read = terrainReader(world.baseline, chunks);
  const point = (i: number): ResidentPoint => {
    const x = ((i % g.n) + g.min + 0.5) / 2,
      y = (Math.floor(i / g.n) + g.min + 0.5) / 2;
    return { x, y, height: read.height(x, y)! };
  };
  const neighbours = (i: number) =>
    [
      i % g.n > 0 ? i - 1 : -1,
      i % g.n < g.n - 1 ? i + 1 : -1,
      i - g.n,
      i + g.n,
    ].filter((j) => j >= 0 && j < g.grid.length && g.grid[j]);
  const nearest = (x: number, y: number, choices: number[]) =>
    choices.reduce((best, i) => {
      const p = point(i),
        b = best < 0 ? null : point(best);
      return !b ||
        (p.x - x) ** 2 + (p.y - y) ** 2 < (b.x - x) ** 2 + (b.y - y) ** 2
        ? i
        : best;
    }, -1);
  const valid = [...g.grid.keys()].filter(
    (i) =>
      g.grid[i] &&
      Math.hypot(
        point(i).x - world.structure.entrance.x,
        point(i).y - world.structure.entrance.y,
      ) < 14,
  );
  const root = nearest(
      world.structure.entrance.x,
      world.structure.entrance.y,
      valid,
    ),
    reachable: number[] = [];
  if (root >= 0) {
    const seen = new Set([root]),
      q = [root];
    for (let a = 0; a < q.length; a++) {
      const i = q[a]!;
      reachable.push(i);
      for (const j of neighbours(i))
        if (!seen.has(j)) {
          seen.add(j);
          q.push(j);
        }
    }
  }
  const result: LivingVillage = {
    rules: LIVING_GOAL_RULES,
    worldId: world.id,
    baselineHash: world.baseline.hash,
    topologyEpoch: world.topologyEpoch,
    serverTimeMs,
    stepMs: 1000,
    residents: [],
  };
  if (!reachable.length) return result;
  const path = (a: number, b: number) => {
    const parent = new Int32Array(g.grid.length).fill(-1),
      q = [a];
    parent[a] = a;
    for (let n = 0; n < q.length && parent[b] === -1; n++)
      for (const j of neighbours(q[n]!))
        if (parent[j] === -1) {
          parent[j] = q[n]!;
          q.push(j);
        }
    const out = [b];
    while (out.at(-1) !== a) out.push(parent[out.at(-1)!]!);
    return out.reverse().map(point);
  };
  const shelter = places.find((p) => p.id === world.structure.id),
    workshop = places.find((p) => p.template === "wf2-workshop-1");
  result.residents = PEOPLE.map(([slug, name, role, color], i) => {
    const rest = nearest(-3 + i * 2, 6 + (i % 2) * 1.5, reachable),
      social = nearest(
        i < 2 ? -3 + i * 1.5 : 1.5 + (i - 2) * 1.5,
        4.5,
        reachable,
      );
    const building = i === 2 && workshop ? workshop : shelter;
    const work = building
      ? nearest(
          building.entrance.x + (i === 2 ? 0 : i - 1.5),
          building.entrance.y + 0.5,
          reachable,
        )
      : -1;
    const observe = building
      ? nearest(
          building.entrance.x - 2.5 + (i % 2) * 5,
          building.entrance.y + 1 + Math.floor(i / 2) * 0.5,
          reachable,
        )
      : -1;
    const goals: ResidentGoal[] = [
      {
        id: "rest",
        activity: "rest",
        label: "Resting",
        location: "Quiet clearing",
        structureId: null,
        position: point(rest),
        face: { x: 1, y: 1 },
        priority: 32 + i * 3,
        durationMs: 22000 + i * 1500,
      },
    ];
    if (
      building &&
      work >= 0 &&
      Math.hypot(
        point(work).x - building.entrance.x,
        point(work).y - building.entrance.y,
      ) < 2
    ) {
      goals.push({
        id: "work",
        activity: "work",
        label:
          i === 2 && workshop
            ? "Mending at the workshop"
            : i === 1
              ? "Preparing the gathering place"
              : "Tending the shelter entrance",
        location:
          i === 2 && workshop
            ? "Mending Shed entrance"
            : "Gathering Shelter entrance",
        structureId: building.id,
        position: point(work),
        face: building.entrance,
        priority: [61, 69, 78, 54][i]!,
        durationMs: 26000 + i * 2300,
      });
    }
    if (
      building &&
      observe >= 0 &&
      Math.hypot(
        point(observe).x - building.entrance.x,
        point(observe).y - building.entrance.y,
      ) < 5
    )
      goals.push({
        id: "observe",
        activity: "observe",
        label:
          i === 0 ? "Checking the entrance path" : "Inspecting the village",
        location:
          building === workshop
            ? "Beside the Mending Shed"
            : "Beside the Gathering Shelter",
        structureId: building.id,
        position: point(observe),
        face: building.entrance,
        priority: [65, 44, 38, 72][i]!,
        durationMs: 14000 + i * 1600,
      });
    goals.push({
      id: "social",
      activity: "gather",
      label: "Conversation",
      location: "Shelter forecourt",
      structureId: shelter?.id ?? null,
      position: point(social),
      face: point(social),
      priority: 100,
      durationMs: 24000,
    });
    const indices = new Map([
      ["rest", rest],
      ["work", work],
      ["observe", observe],
      ["social", social],
    ]);
    const routes = goals.flatMap((a) =>
      goals.map((b) => ({
        from: a.id,
        to: b.id,
        points: path(indices.get(a.id)!, indices.get(b.id)!),
      })),
    );
    return {
      id: `${world.id}:lw1:${slug}`,
      name,
      role,
      fictional: true,
      color,
      phaseMs: i * 17000,
      stops: [],
      goals,
      routes,
    };
  });
  // A conversation is offered to both partners only if their positions and all approaches fit its reservation.
  for (const [a, b] of [
    [0, 1],
    [2, 3],
  ]) {
    const x = result.residents[a!]!,
      y = result.residents[b!]!,
      gx = x.goals!.find((g) => g.id === "social")!,
      gy = y.goals!.find((g) => g.id === "social")!;
    const d = Math.hypot(
      gx.position.x - gy.position.x,
      gx.position.y - gy.position.y,
    );
    if (
      d < 0.75 ||
      d > 2.5 ||
      [x, y].some((r) => r.routes!.some((p) => p.points.length > 54))
    ) {
      for (const r of [x, y]) {
        r.goals = r.goals!.filter((g) => g.id !== "social");
        r.routes = r.routes!.filter(
          (p) => p.from !== "social" && p.to !== "social",
        );
      }
    } else {
      gx.face = gy.position;
      gy.face = gx.position;
    }
  }
  return result;
}

type Action = {
  start: number;
  travelStart: number;
  arrival: number;
  perform: number;
  end: number;
  complete: number;
  goal: ResidentGoal;
  route: ResidentPoint[];
  partnerId: string | null;
  score: number;
  count: number;
};
const cache = new WeakMap<LivingVillage, Map<number, Action[][]>>();
/** A bounded decision ledger for one shift, reconstructed without earlier shifts or offline ticks. */
export function residentDecisionLedger(
  plan: LivingVillage,
  shift: number,
): Action[][] {
  let saved = cache.get(plan);
  if (!saved) {
    saved = new Map();
    cache.set(plan, saved);
  }
  const existing = saved.get(shift);
  if (existing) return existing;
  const ledgers = plan.residents.map((r, index) => {
    const goals = r.goals!,
      rest = goals.find((g) => g.id === "rest")!,
      actions: Action[] = [];
    const path = (from: string, to: string) =>
      r.routes!.find((p) => p.from === from && p.to === to)!.points;
    const travel = (from: string, to: string) =>
      (path(from, to).length - 1) * plan.stepMs;
    let t = 0,
      current = rest,
      count = 0,
      fatigue = (index + (shift % 3)) * 8;
    const completed: Record<string, number> = {
      work: -35000 - index * 2000,
      rest: -10000,
      observe: -28000,
      social: -60000,
    };
    const social = goals.find((g) => g.id === "social"),
      partner = plan.residents[index % 2 === 0 ? index + 1 : index - 1];
    const meet = 70000 + Math.floor(index / 2) * 50000;
    let met = !social || !partner;
    const add = (
      goal: ResidentGoal,
      duration: number,
      score: number,
      performAt?: number,
    ) => {
      const route = path(current.id, goal.id),
        travelStart = t + CHOOSE,
        arrival = travelStart + (route.length - 1) * plan.stepMs;
      const perform = Math.max(arrival + ARRIVE, performAt ?? 0),
        end = perform + duration;
      actions.push({
        start: t,
        travelStart,
        arrival,
        perform,
        end,
        complete: end + COMPLETE,
        goal,
        route,
        partnerId: goal.id === "social" ? partner!.id : null,
        score,
        count,
      });
      t = end + COMPLETE;
      current = goal;
      completed[goal.id] = t;
      count++;
      fatigue = Math.max(
        0,
        Math.min(
          100,
          fatigue + (goal.id === "work" ? 24 : goal.id === "rest" ? -65 : 7),
        ),
      );
    };
    // Role-specific initial decisions start at different times while remaining at a valid rest point.
    add(rest, 1000 + index * 1900, 0);
    while (t < RESIDENT_SHIFT_MS && actions.length < 18) {
      const returnMs = CHOOSE + travel(current.id, "rest") + ARRIVE + COMPLETE;
      if (
        !met &&
        social &&
        t + CHOOSE + travel(current.id, "social") + ARRIVE >= meet - 2500
      ) {
        add(social, 24000, 1000, meet);
        met = true;
        continue;
      }
      const hour = Math.floor(
        ((shift * RESIDENT_SHIFT_MS + EPOCH) % 86400000) / 3600000,
      );
      const scored = goals
        .filter((g) => g.id !== "social" && g.id !== current.id)
        .map((g) => ({
          goal: g,
          score:
            g.priority +
            ((t - completed[g.id]!) / 1000) * 0.8 +
            (g.id === "rest" ? fatigue : 0) +
            (g.id === "observe" ? ((shift + index) % 4) * 6 : 0) +
            (g.id === "work" && hour >= 7 && hour < 20 ? 10 : 0),
        }))
        .sort(
          (a, b) => b.score - a.score || a.goal.id.localeCompare(b.goal.id),
        );
      const choice = scored.find(({ goal: g }) => {
        const end =
          t +
          CHOOSE +
          travel(current.id, g.id) +
          ARRIVE +
          g.durationMs +
          COMPLETE;
        return (
          end + CHOOSE + travel(g.id, "rest") + ARRIVE + COMPLETE <=
            RESIDENT_SHIFT_MS &&
          (met ||
            !social ||
            end + CHOOSE + travel(g.id, "social") + ARRIVE <= meet)
        );
      });
      if (choice) {
        add(choice.goal, choice.goal.durationMs, choice.score);
        continue;
      }
      if (!met && social) {
        add(social, 24000, 1000, meet);
        met = true;
        continue;
      }
      if (t + returnMs <= RESIDENT_SHIFT_MS) {
        add(rest, Math.max(0, RESIDENT_SHIFT_MS - t - returnMs), 0);
      }
      break;
    }
    return actions;
  });
  saved.set(shift, ledgers);
  if (saved.size > 2) saved.delete(saved.keys().next().value!);
  return ledgers;
}

export function evaluateGoalResidents(
  plan: LivingVillage,
  timeMs: number,
  reduced = false,
): ResidentState[] {
  const shifted = timeMs - EPOCH,
    shift = Math.floor(shifted / RESIDENT_SHIFT_MS),
    local =
      ((shifted % RESIDENT_SHIFT_MS) + RESIDENT_SHIFT_MS) % RESIDENT_SHIFT_MS;
  const ledgers = residentDecisionLedger(plan, shift);
  return plan.residents.map((r, i) => {
    const a =
      ledgers[i]!.find((a) => local < a.complete) ?? ledgers[i]!.at(-1)!;
    const phase =
      local < a.travelStart
        ? "choosing"
        : local < a.arrival
          ? "travel"
          : local < a.perform
            ? "arriving"
            : local < a.end
              ? "performing"
              : "complete";
    const moving = phase === "travel",
      t = Math.max(0, local - a.travelStart),
      step = Math.min(a.route.length - 1, Math.floor(t / plan.stepMs));
    const p = moving
        ? a.route[step]!
        : phase === "choosing"
          ? a.route[0]!
          : a.route.at(-1)!,
      q = moving ? a.route[step + 1]! : p,
      f = moving && !reduced ? (t % plan.stepMs) / plan.stepMs : 0;
    const position = {
      x: p.x + (q.x - p.x) * f,
      y: p.y + (q.y - p.y) * f,
      height: p.height + (q.height - p.height) * f,
    };
    const direction = moving
      ? { x: q.x - p.x, y: q.y - p.y }
      : { x: a.goal.face.x - position.x, y: a.goal.face.y - position.y };
    const partner = plan.residents.find((r) => r.id === a.partnerId);
    const label =
      a.goal.id === "social" && partner
        ? `Talking with ${partner.name}`
        : a.goal.label;
    const start =
      phase === "travel"
        ? a.travelStart
        : phase === "arriving"
          ? a.arrival
          : phase === "performing"
            ? a.perform
            : phase === "complete"
              ? a.end
              : a.start;
    const end =
      phase === "travel"
        ? a.arrival
        : phase === "arriving"
          ? a.perform
          : phase === "performing"
            ? a.end
            : phase === "complete"
              ? a.complete
              : a.travelStart;
    return {
      id: r.id,
      activity: moving
        ? "travel"
        : phase === "performing"
          ? a.goal.activity
          : "idle",
      destinationActivity: a.goal.activity,
      location: a.goal.location,
      structureId: a.goal.structureId,
      position,
      direction,
      goalId: a.goal.id,
      actionPhase: phase,
      actionLabel: moving
        ? `Heading to ${a.goal.location.toLowerCase()}`
        : phase === "arriving"
          ? a.goal.id === "social"
            ? `Meeting ${partner?.name ?? "a neighbour"}`
            : "Settling into place"
          : phase === "choosing"
            ? "Choosing what to do next"
            : phase === "complete"
              ? "Finishing up"
              : label,
      partnerId: a.partnerId,
      phaseProgress: Math.max(
        0,
        Math.min(1, (local - start) / Math.max(1, end - start)),
      ),
      completedActions: a.count,
      decisionScore: a.score,
    };
  });
}
