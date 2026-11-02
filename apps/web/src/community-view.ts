import type { WorldEntry } from "@creators-village/contracts";

export type CommunityAccount = {
  grants: { worldId: string; canContribute: boolean }[];
  requests: { requestId: string; worldId: string; state: string }[];
};
/** Request approval is history; only the current grant permits an entry link. */
export function requestView(
  request: CommunityAccount["requests"][number],
  grants: CommunityAccount["grants"],
) {
  const allowed = grants.some((g) => g.worldId === request.worldId);
  if (request.state === "approved")
    return allowed
      ? {
          label: "Approved",
          tone: "sage",
          enter: true,
          detail: "Your membership is active.",
        }
      : {
          label: "Access unavailable",
          tone: "muted",
          enter: false,
          detail: "This earlier approval does not currently grant access.",
        };
  if (request.state === "pending")
    return {
      label: "Request pending",
      tone: "honey",
      enter: false,
      detail: "Waiting for the creator’s decision.",
    };
  if (request.state === "rejected")
    return {
      label: "Not authorized",
      tone: "muted",
      enter: false,
      detail: "The creator did not approve this request.",
    };
  if (request.state === "withdrawn")
    return {
      label: "Withdrawn",
      tone: "muted",
      enter: false,
      detail: "This request has been withdrawn.",
    };
  return {
    label: "Check request",
    tone: "muted",
    enter: false,
    detail: "Open your requests for the current status.",
  };
}
export function appendJoined(previous: WorldEntry[], next: WorldEntry[]) {
  const ids = new Set(previous.map((w) => w.id));
  const result = [...previous];
  for (const world of next) {
    if (!ids.has(world.id)) {
      ids.add(world.id);
      result.push(world);
    }
  }
  return result;
}
