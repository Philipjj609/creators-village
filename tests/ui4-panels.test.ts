import { expect, it } from "vitest";
import {
  admissionPageCursor,
  contributionAccess,
} from "../apps/web/src/village-panel-state.js";
const open = { state: "open" as const, goal: 2, acceptedCount: 0 };
it("offers work only after a current grant is loaded and before a receipt or full target", () => {
  expect(contributionAccess(open, true, true, false).allowed).toBe(true);
  for (const [loaded, grant, receipt] of [
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ])
    expect(contributionAccess(open, loaded!, grant!, receipt!).allowed).toBe(
      false,
    );
  expect(
    contributionAccess({ ...open, acceptedCount: 2 }, true, true, false)
      .allowed,
  ).toBe(false);
});
it("never offers contributions on drafts, queued, blocked, completed or cancelled projects", () => {
  for (const state of [
    "draft",
    "ready",
    "blocked",
    "completed",
    "cancelled",
  ] as const)
    expect(
      contributionAccess({ ...open, state }, true, true, false).allowed,
    ).toBe(false);
});
it("keeps receipt feedback after access changes instead of presenting a new opportunity", () => {
  expect(contributionAccess(open, true, false, true).message).toBe(
    "Your contribution is recorded.",
  );
});

it("advances both admission queues without skipping the slower UUID list", () => {
  const page = {
    requests: Array.from({ length: 20 }, (_, i) => ({
      requestId: String(i + 1).padStart(3, "0"),
    })),
    members: Array.from({ length: 20 }, (_, i) => ({
      memberId: String(i + 101).padStart(3, "0"),
    })),
  };
  expect(admissionPageCursor(page)).toBe("020");
  expect(admissionPageCursor({ ...page, requests: [] })).toBe("120");
  expect(admissionPageCursor({ requests: [], members: [] })).toBe(null);
});
