import { constructionView, type Wf2State } from "@creators-village/contracts";
import type { ObjectRef } from "./village-selection.js";
export function projectForPlace(ref: ObjectRef | null, state: Wf2State | null) {
  return state?.projects.find((p) =>
    ref?.kind === "site"
      ? p.id === ref.id
      : ref?.kind === "structure" && "wf2-workshop-" + p.id === ref.id,
  );
}
export function canonicalPlace(
  ref: ObjectRef | null,
  state: Wf2State | null,
): ObjectRef | null {
  const p = projectForPlace(ref, state);
  return ref?.kind === "site" &&
    p &&
    state &&
    constructionView(p, state.structures).phase === "completed"
    ? { kind: "structure", id: "wf2-workshop-" + p.id }
    : ref;
}
