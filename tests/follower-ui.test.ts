import { createRequire } from "node:module";
import { expect, it } from "vitest";
import {
  FollowDiscovery,
  bannerFor,
  followError,
} from "../apps/web/src/FollowDiscovery.js";
import { HttpError } from "../apps/web/src/api.js";

// React lives with the web app, not the repository root.
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createElement } = web("react") as typeof import("react");
const { renderToString } = web("react-dom/server") as {
  renderToString: (node: unknown) => string;
};
const base = { requiredScope: "user:read:follows" as const };
const render = (
  discovery: Parameters<typeof FollowDiscovery>[0]["discovery"],
) =>
  renderToString(
    createElement(FollowDiscovery, {
      discovery,
      csrf: "csrf",
      onChanged: () => {},
    }),
  );

it("F4 UI: with the feature off the R1 copy is kept and no follow control is offered", () => {
  const html = render({ status: "not-connected", ...base });
  expect(html).toContain("Twitch-follow discovery isn");
  expect(html).not.toContain("/auth/twitch/follows");
});

it("F4 UI: not-connected offers an optional connection that is not a sign-in", () => {
  const html = render({ status: "not-connected", ...base, available: true });
  expect(html).toContain('href="/auth/twitch/follows"');
  expect(html).toContain("never grants");
  expect(html).not.toContain("Join village");
});

it("F4 UI: connected lists only provided villages with plain permission copy and a manual refresh", () => {
  const html = render({
    status: "connected",
    ...base,
    available: true,
    syncedAt: new Date().toISOString(),
    villages: [
      {
        worldId: "w1",
        name: "Willow Workshop",
        creatorDisplayName: "Mira Vale",
        followersCanContribute: false,
      },
    ],
  });
  expect(html).toContain("Willow Workshop");
  expect(html).toContain("Join village");
  expect(html).toContain("Refresh");
  expect(html).toContain("Contributing is up to the creator");
  expect(html).toContain("never removes");
  expect(html).not.toMatch(/token|csrf/i);
});

it("F4 UI: connected with no matches explains the empty state; errors map to safe copy", () => {
  expect(
    render({ status: "connected", ...base, available: true, villages: [] }),
  ).toContain("No villages you follow are open to followers yet");
  expect(followError(new HttpError("NOT_FOLLOWING", 403))).toContain(
    "no longer follow",
  );
  expect(followError(new HttpError("COMMUNITY_FULL", 409))).toContain("limit");
  expect(followError(new Error("boom"))).not.toContain("boom");
  expect(bannerFor("?follows=failed")?.kind).toBe("error");
  expect(bannerFor("?follows=other")).toBeNull();
});
