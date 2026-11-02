import type { ResidentState } from "@creators-village/contracts";

export type ArtDirection = "se" | "sw" | "nw" | "ne";
/** Stable fictional identity binding, independent of array order, Twitch identity or art display names. */
export function residentArtwork(id: string) {
  if (!id.includes(":lw1:")) return null;
  const suffix = id.split(":").at(-1);
  return (
    (
      {
        mira: "courier",
        oren: "caretaker",
        nell: "maker",
        ivo: "gardener",
      } as const
    )[suffix as "mira" | "oren" | "nell" | "ivo"] ?? null
  );
}
export function artDirection({ x, y }: { x: number; y: number }): ArtDirection {
  return Math.abs(x) >= Math.abs(y)
    ? x >= 0
      ? "se"
      : "nw"
    : y >= 0
      ? "sw"
      : "ne";
}
export function semanticAnimation(s: ResidentState, reacting: boolean) {
  if (s.activity === "travel") return "walk";
  if (reacting) return "react";
  if (s.actionPhase && s.actionPhase !== "performing") return "idle";
  return ["work", "observe", "gather", "rest"].includes(s.activity)
    ? s.activity
    : "idle";
}
export function walkFrame(distance: number, stride: number, frames: number) {
  return Math.floor((Math.max(0, distance) / stride) * frames) % frames;
}

/** Prepare a complete visual set before publishing a plan. Rejected/stale loads own no scene nodes. */
export async function prepareResidentArtwork<T>(
  ids: string[],
  create: (id: string) => Promise<T>,
  current: () => boolean,
  destroy: (actor: T) => void,
) {
  if (new Set(ids).size !== ids.length)
    throw Error("Duplicate fictional resident identity");
  const results = await Promise.allSettled(
    ids.map(async (id) => ({ id, actor: await create(id) })),
  );
  const ready = results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );
  const failure = results.find((r) => r.status === "rejected");
  if (!current() || failure) {
    for (const value of ready) destroy(value.actor);
    if (current() && failure?.status === "rejected") throw failure.reason;
    return null;
  }
  return ready;
}
