/** Fictional residents are never provider identities, memberships or presence. */
export const LIVING_RULES = "lw1-routines-1" as const;
export const LIVING_GOAL_RULES = "lw1-goals-1" as const;
export type ResidentActivity =
  "idle" | "travel" | "work" | "gather" | "rest" | "observe";
export type ResidentPoint = { x: number; y: number; height: number };
export type ResidentStop = {
  label: string;
  structureId: string | null;
  activity: Exclude<ResidentActivity, "travel">;
  dwellMs: number;
  route: ResidentPoint[];
};
export type ResidentRoutine = {
  id: string;
  name: string;
  role: string;
  fictional: true;
  color: number;
  phaseMs: number;
  stops: ResidentStop[];
  goals?: ResidentGoal[];
  routes?: { from: string; to: string; points: ResidentPoint[] }[];
};
export type ResidentGoal = {
  id: "rest" | "work" | "observe" | "social";
  activity: Exclude<ResidentActivity, "travel" | "idle">;
  label: string;
  location: string;
  structureId: string | null;
  position: ResidentPoint;
  face: { x: number; y: number };
  priority: number;
  durationMs: number;
};
export type LivingVillage = {
  rules: typeof LIVING_RULES | typeof LIVING_GOAL_RULES;
  worldId: string;
  baselineHash: string;
  topologyEpoch: string;
  serverTimeMs: number;
  stepMs: 1000;
  residents: ResidentRoutine[];
};
export type ResidentState = {
  id: string;
  activity: ResidentActivity;
  destinationActivity: ResidentStop["activity"];
  location: string;
  structureId: string | null;
  position: ResidentPoint;
  direction: { x: number; y: number };
  goalId?: ResidentGoal["id"];
  actionPhase?: "choosing" | "travel" | "arriving" | "performing" | "complete";
  actionLabel?: string;
  partnerId?: string | null;
  phaseProgress?: number;
  completedActions?: number;
  decisionScore?: number;
};
