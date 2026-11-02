import type { Wf2Project } from "@creators-village/contracts";
/** Presentation eligibility only; the existing server remains the authority. */
export function contributionAccess(
  p: Pick<Wf2Project, "state" | "acceptedCount" | "goal">,
  loaded: boolean,
  grant: boolean,
  receipt: boolean,
) {
  if (!loaded)
    return { allowed: false, message: "Checking contribution access…" };
  if (receipt)
    return { allowed: false, message: "Your contribution is recorded." };
  if (p.state !== "open")
    return {
      allowed: false,
      message: "This project is not accepting contributions.",
    };
  if (!grant)
    return {
      allowed: false,
      message:
        "You can view this project. Contribution access requires the creator’s approval.",
    };
  if (p.acceptedCount >= p.goal)
    return {
      allowed: false,
      message: "Required contributions have been received.",
    };
  return { allowed: true, message: "Contribute once to this project." };
}

/** The existing endpoint pages both UUID-ordered lists with one cursor. */
export function admissionPageCursor(page: {
  requests: { requestId: string }[];
  members: { memberId: string }[];
}) {
  const cursors = [
    page.requests.length === 20 ? page.requests.at(-1)!.requestId : null,
    page.members.length === 20 ? page.members.at(-1)!.memberId : null,
  ].filter((v): v is string => Boolean(v));
  return cursors.sort()[0] ?? null;
}

export function villageActionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    ALREADY_CONTRIBUTED:
      "Your contribution is already recorded for this project.",
    TARGET_REACHED: "The required contributions have already been received.",
    PROJECT_NOT_OPEN:
      "This project is no longer accepting that action. Refresh its details.",
    FORBIDDEN: "Your current access does not allow this action.",
    AUTH_REQUIRED: "Reconnect with Twitch to continue.",
    STALE_TARGET: "This item has changed. Refresh before trying again.",
    PLAN_CHANGED:
      "The plan has changed. Refresh its details before trying again.",
    ACTIVE_PROJECT_LIMIT:
      "The current limit for active construction projects has been reached.",
  };
  return (
    labels[message] ??
    (/^[A-Z][A-Z0-9_]+$/.test(message)
      ? "The action could not be completed. Refresh the village and check your access."
      : message)
  );
}
