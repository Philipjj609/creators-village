import type { ResidentState } from "@creators-village/contracts";
export function residentActivity(state: ResidentState | undefined) {
  if (!state) return "Activity unavailable";
  const label =
    state.actionLabel ??
    (state.activity === "travel"
      ? "Heading to " + state.location
      : state.activity[0]!.toUpperCase() + state.activity.slice(1));
  return label
    .replace(/^Heading to beside /i, "Heading towards ")
    .replace(/^At beside /i, "Beside ");
}
