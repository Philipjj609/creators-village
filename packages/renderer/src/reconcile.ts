import { constructionView, type Wf2State } from "@creators-village/contracts";
/** Classify authoritative updates without rebuilding unchanged terrain for accepted-work counters. */
export function renderDelta(previous: Wf2State | null, next: Wf2State) {
  return {
    pathsChanged:
      !previous ||
      JSON.stringify(previous.paths) !== JSON.stringify(next.paths),
    newlyCompleted: previous
      ? next.projects.filter(
          (p) =>
            p.state === "completed" &&
            previous.projects.find((old) => old.id === p.id)?.state !==
              "completed" &&
            constructionView(p, next.structures).phase === "completed",
        )
      : [],
  };
}
