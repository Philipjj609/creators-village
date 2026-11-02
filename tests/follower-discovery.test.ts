import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import { admissionCommand } from "../apps/server/src/participation-admission.js";
import { checkPlacement } from "../apps/server/src/placement.js";
import { fundOrbs } from "../apps/server/src/orbs.js";
import {
  ProviderError,
  type TwitchGateway,
} from "../apps/server/src/twitch.js";
import { seedUi2, ui2Key, ui2Origin } from "../scripts/ui2-fixture.mjs";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!);
// Never the shared development database: use the branch-owned container.
if (url.hostname !== "127.0.0.1" || url.port === "55432")
  throw Error("Follower tests require an isolated local PostgreSQL");
const admin = createPool(url.toString());
url.pathname = "/creators_village_follow_test";
const pool = createPool(url.toString());
let fixture: Awaited<ReturnType<typeof seedUi2>>,
  app: Awaited<ReturnType<typeof buildApp>>;
const FOLLOW = "user:read:follows";
// Mutable fake Twitch state: who follows whom, which scopes a code grants, and failure injection.
const follows = new Map<string, string[]>();
const scopesFor: Record<string, string[]> = {};
let followCalls = 0;
let failFollowWith: number | null = null;
const provider: TwitchGateway = {
  exchange: async (code) => ({
    access_token: "oauth:" + code,
    refresh_token: "oauth:" + code,
    expires_in: 7200,
  }),
  refresh: async () => {
    throw Error("unused");
  },
  validate: async (access) => {
    const role = access.replace(/^oauth:/, "");
    const a = fixture.actors[role];
    if (!a) throw Error("unknown");
    const scopes = access.startsWith("oauth:") ? scopesFor[role] : undefined;
    return {
      subject: "ui2-" + role,
      displayName: a.name,
      login: "ui2_" + role,
      ...(scopes?.length ? { scopes } : {}),
    };
  },
  followedBroadcasters: async (_access, userId) => {
    followCalls++;
    if (failFollowWith) throw new ProviderError(failFollowWith);
    return [...(follows.get(userId) ?? []), "someone-without-a-village"];
  },
  isFollowing: async (_access, userId, broadcaster) => {
    if (failFollowWith) throw new ProviderError(failFollowWith);
    return (follows.get(userId) ?? []).includes(broadcaster);
  },
};
const config = {
  databaseUrl: url.toString(),
  clientId: "synthetic",
  clientSecret: "unused",
  redirectUri: ui2Origin + "/auth/twitch/callback",
  webOrigin: ui2Origin,
  encryptionKey: ui2Key,
  secureCookies: false,
  production: true,
  followerDiscovery: true,
  wf2WorldId: "",
};
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_follow_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people CASCADE");
  fixture = await seedUi2(pool, 0);
  config.wf2WorldId = fixture.mainWorld;
  app = await buildApp(config, pool, provider);
}, 60000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
const actor = (role: string) => fixture.actors[role];
// Spread requests across addresses so the per-IP public rate budget never masks results.
let hits = 0;
const ip = () => "10.1." + Math.floor(hits++ / 40) + ".1";
function call(
  method: "GET" | "POST" | "PUT",
  path: string,
  role?: string,
  body?: unknown,
) {
  const a = role ? actor(role) : undefined;
  return app.inject({
    method,
    url: path,
    remoteAddress: ip(),
    headers: {
      ...(a ? { cookie: "cv_session=" + a.raw } : {}),
      ...(method !== "GET" && a
        ? { origin: ui2Origin, "x-csrf-token": a.csrf }
        : {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}
const world = () => fixture.mainWorld;
const settingsPath = () => "/api/worlds/" + world() + "/community-settings";
async function grantScope(role: string) {
  await pool.query(
    "UPDATE sessions SET granted_scopes=ARRAY['user:read:follows'] WHERE session_hash=$1",
    [actor(role).session_hash],
  );
}
async function resetCooldown(role: string) {
  await pool.query(
    "UPDATE wf2_follow_sync SET next_allowed_at=now() WHERE person_id=$1",
    [actor(role).id],
  );
}
async function configure(
  followerJoinEnabled: boolean,
  memberLimit: number,
  followerCanContribute = false,
) {
  const current = (await call("GET", settingsPath(), "owner")).json();
  const r = await call("PUT", settingsPath(), "owner", {
    followerJoinEnabled,
    followerCanContribute,
    memberLimit,
    expectedRevision: current.revision,
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}
const cmd = (kind: string, payload: object = {}) => ({
  commandSchema: "wf2-command-1",
  commandId: randomUUID(),
  kind,
  payload,
});
async function membership(role: string) {
  return (
    await pool.query(
      "SELECT m.state,m.join_source,g.can_view,g.can_contribute,g.can_create_projects,g.can_manage_construction,g.can_moderate FROM wf2_memberships m LEFT JOIN wf2_world_grants g ON g.person_id=m.person_id AND g.world_id=$2 WHERE m.person_id=$1 AND m.community_id=(SELECT community_id FROM wf2_bindings WHERE world_id=$2)",
      [actor(role).id, world()],
    )
  ).rows[0];
}

it("F4: disabled by default — R1 behavior and response shape are unchanged", async () => {
  const r = await call("GET", "/api/communities", "empty");
  expect(r.json().followDiscovery).toEqual({
    status: "not-connected",
    requiredScope: FOLLOW,
    available: true,
  });
  // No opt-in, no scope: refresh and join are refused without revealing anything.
  expect(
    (await call("POST", "/api/communities/follows/refresh", "empty"))
      .statusCode,
  ).toBe(403);
  const join = await call("POST", "/api/communities/follows/join", "empty", {
    worldId: world(),
  });
  expect(join.statusCode).toBe(403);
  await grantScope("empty");
  follows.set("ui2-empty", ["ui2-owner"]);
  expect(
    (
      await call("POST", "/api/communities/follows/join", "empty", {
        worldId: world(),
      })
    ).statusCode,
  ).toBe(404);
  const view = (await call("GET", settingsPath(), "owner")).json();
  expect(view).toMatchObject({
    followerJoinEnabled: false,
    followerCanContribute: false,
    limitIsLegacy: true,
    memberLimit: 8,
    activeMembers: 1,
  });
});

it("F4: only the creator may read or change community settings; stale revisions are rejected", async () => {
  expect((await call("GET", settingsPath())).statusCode).toBe(404);
  expect((await call("GET", settingsPath(), "member")).statusCode).toBe(403);
  const bad = await call("PUT", settingsPath(), "member", {
    followerJoinEnabled: true,
    followerCanContribute: true,
    memberLimit: 10,
    expectedRevision: "0",
  });
  expect(bad.statusCode).toBe(403);
  for (const body of [
    {
      followerJoinEnabled: "yes",
      followerCanContribute: false,
      memberLimit: 5,
      expectedRevision: "0",
    },
    {
      followerJoinEnabled: true,
      followerCanContribute: false,
      memberLimit: 0,
      expectedRevision: "0",
    },
    {
      followerJoinEnabled: true,
      followerCanContribute: false,
      memberLimit: 5001,
      expectedRevision: "0",
    },
    {
      followerJoinEnabled: true,
      followerCanContribute: false,
      memberLimit: 2.5,
      expectedRevision: "0",
    },
    { followerJoinEnabled: true, followerCanContribute: false, memberLimit: 5 },
  ])
    expect((await call("PUT", settingsPath(), "owner", body)).statusCode).toBe(
      400,
    );
  const stale = await call("PUT", settingsPath(), "owner", {
    followerJoinEnabled: true,
    followerCanContribute: false,
    memberLimit: 50,
    expectedRevision: "7",
  });
  expect(stale.statusCode).toBe(409);
  const ok = await configure(true, 50);
  expect(ok).toMatchObject({
    followerJoinEnabled: true,
    memberLimit: 50,
    limitIsLegacy: false,
    revision: "1",
  });
  // The R1 eight-member cap no longer binds membership once configured.
  expect(ok.memberLimit).toBeGreaterThan(ok.legacyMemberLimit);
});

it("F4: follow-based discovery lists only opted-in villages, stores no full follow list, and is rate limited", async () => {
  const before = (await call("GET", "/api/communities", "empty")).json();
  expect(before.followDiscovery.status).toBe("connected");
  expect(before.followDiscovery.villages).toEqual([]);
  const r = await call("POST", "/api/communities/follows/refresh", "empty");
  expect(r.statusCode).toBe(200);
  expect(r.json().villages).toEqual([
    expect.objectContaining({
      worldId: world(),
      name: "Willow Workshop",
      creatorDisplayName: "Mira Vale",
      followersCanContribute: false,
    }),
  ]);
  expect(r.body).not.toMatch(
    /someone-without-a-village|twitch_subject|ui2-owner|csrf|encrypted/,
  );
  const rows = (
    await pool.query("SELECT * FROM wf2_follow_matches WHERE person_id=$1", [
      actor("empty").id,
    ])
  ).rows;
  expect(rows).toHaveLength(1);
  const again = await call("POST", "/api/communities/follows/refresh", "empty");
  expect(again.statusCode).toBe(429);
  expect(again.headers["retry-after"]).toBeTruthy();
  // Followed creators without an opted-in village never appear.
  follows.set("ui2-pending", ["ui2-host"]);
  await grantScope("pending");
  const other = await call(
    "POST",
    "/api/communities/follows/refresh",
    "pending",
  );
  expect(other.json().villages).toEqual([]);
});

it("F4: a verified follower joins immediately with view-only access; joining is idempotent", async () => {
  const join = await call("POST", "/api/communities/follows/join", "empty", {
    worldId: world(),
  });
  expect(join.statusCode).toBe(200);
  expect(join.json()).toEqual({
    worldId: world(),
    state: "active",
    joined: true,
  });
  expect(await membership("empty")).toMatchObject({
    state: "active",
    join_source: "follower",
    can_view: true,
    can_contribute: false,
    can_create_projects: false,
    can_manage_construction: false,
    can_moderate: false,
  });
  expect(
    (
      await call("POST", "/api/communities/follows/join", "empty", {
        worldId: world(),
      })
    ).json().joined,
  ).toBe(false);
  const list = (await call("GET", "/api/communities", "empty")).json();
  expect(list.joined.map((w: { id: string }) => w.id)).toContain(world());
  expect(list.followDiscovery.villages).toEqual([]);
  // Membership alone does not allow Orb contribution or creator operations.
  await expect(
    fundOrbs(pool, actor("empty"), world(), {
      commandId: randomUUID(),
      projectId: randomUUID(),
      planHash: "0".repeat(64),
      amount: 1,
    } as never),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    checkPlacement(pool, actor("empty"), world(), { qx: 0, qy: 0 }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    admissionCommand(
      pool,
      config,
      actor("empty"),
      world(),
      cmd("IssueInvitation") as never,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("F4: unfollowing removes discovery but never membership, grants or history", async () => {
  follows.set("ui2-pending", ["ui2-owner"]);
  await resetCooldown("pending");
  expect(
    (await call("POST", "/api/communities/follows/refresh", "pending")).json()
      .villages,
  ).toHaveLength(1);
  follows.set("ui2-pending", []);
  await resetCooldown("pending");
  expect(
    (await call("POST", "/api/communities/follows/refresh", "pending")).json()
      .villages,
  ).toEqual([]);
  // The earlier follower unfollows: membership, grant and joined listing survive any refresh.
  follows.set("ui2-empty", []);
  await resetCooldown("empty");
  const refreshed = await call(
    "POST",
    "/api/communities/follows/refresh",
    "empty",
  );
  expect(refreshed.json().villages).toEqual([]);
  expect(await membership("empty")).toMatchObject({
    state: "active",
    can_view: true,
  });
  expect(
    (await call("GET", "/api/communities", "empty"))
      .json()
      .joined.map((w: { id: string }) => w.id),
  ).toContain(world());
  // A non-follower cannot join even if they know the world id.
  await grantScope("invited");
  const denied = await call(
    "POST",
    "/api/communities/follows/join",
    "invited",
    { worldId: world() },
  );
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe("NOT_FOLLOWING");
  expect(await membership("invited")).toBeUndefined();
});

it("F4: concurrent follower joins cannot exceed the configured limit", async () => {
  const active = (await call("GET", settingsPath(), "owner")).json()
    .activeMembers;
  await configure(true, active + 1);
  for (const role of ["invited", "lost"]) {
    follows.set("ui2-" + role, ["ui2-owner"]);
    await grantScope(role);
  }
  const results = await Promise.all(
    ["invited", "lost"].map((role) =>
      call("POST", "/api/communities/follows/join", role, { worldId: world() }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe(
    "COMMUNITY_FULL",
  );
  const count = (
    await pool.query(
      "SELECT count(*)::int AS n FROM wf2_memberships WHERE community_id=(SELECT community_id FROM wf2_bindings WHERE world_id=$1) AND state='active' AND person_id<>$2",
      [world(), actor("owner").id],
    )
  ).rows[0].n;
  expect(count).toBe(active + 1);
  await configure(true, 50);
});

it("F4: moderation outranks following; invitation membership remains an alternative", async () => {
  // Rejected by the creator earlier: following does not override that decision.
  follows.set("ui2-denied", ["ui2-owner"]);
  await grantScope("denied");
  expect(
    (
      await call("POST", "/api/communities/follows/join", "denied", {
        worldId: world(),
      })
    ).statusCode,
  ).toBe(403);
  // Ban the follower; the ban survives refresh and rejoin attempts.
  const member = (
    await pool.query(
      "SELECT id,revision FROM wf2_memberships WHERE person_id=$1",
      [actor("empty").id],
    )
  ).rows[0];
  await admissionCommand(
    pool,
    config,
    actor("owner"),
    world(),
    cmd("BanMember", {
      memberId: member.id,
      expectedMembershipRevision: String(member.revision),
    }) as never,
  );
  expect(await membership("empty")).toMatchObject({
    state: "banned",
    can_view: false,
    can_create_projects: false,
    can_moderate: false,
  });
  follows.set("ui2-empty", ["ui2-owner"]);
  await resetCooldown("empty");
  const view = await call("POST", "/api/communities/follows/refresh", "empty");
  expect(view.json().villages).toEqual([]);
  expect(
    (
      await call("POST", "/api/communities/follows/join", "empty", {
        worldId: world(),
      })
    ).statusCode,
  ).toBe(403);
  // Invitation members keep full R1 behavior (view + Orb contribution).
  expect(await membership("member")).toMatchObject({
    state: "active",
    join_source: "invitation",
    can_view: true,
    can_contribute: true,
  });
});

it("F4: membership, Orb contribution, project creation, construction and moderation are separate permissions", async () => {
  const target = (
    await pool.query(
      "SELECT id,revision FROM wf2_memberships WHERE person_id=$1",
      [actor("member").id],
    )
  ).rows[0];
  const path =
    "/api/worlds/" + world() + "/members/" + target.id + "/permissions";
  const view = (await call("GET", path, "owner")).json();
  expect(view.permissions).toEqual({
    canContribute: true,
    canCreateProjects: false,
    canManageConstruction: false,
    canModerate: false,
  });
  // Only the creator may delegate.
  expect(
    (
      await call("PUT", path, "member", {
        expectedMembershipRevision: view.revision,
        permissions: view.permissions,
      })
    ).statusCode,
  ).toBe(403);
  const grant = async (permissions: object) => {
    const current = (await call("GET", path, "owner")).json();
    return call("PUT", path, "owner", {
      expectedMembershipRevision: current.revision,
      permissions,
    });
  };
  const none = {
    canContribute: false,
    canCreateProjects: false,
    canManageConstruction: false,
    canModerate: false,
  };
  expect((await grant({ ...none })).statusCode).toBe(200);
  await expect(
    fundOrbs(pool, actor("member"), world(), {
      commandId: randomUUID(),
      projectId: randomUUID(),
      planHash: "0".repeat(64),
      amount: 1,
    } as never),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  // Create-projects does not grant moderation or Orb contribution.
  expect((await grant({ ...none, canCreateProjects: true })).statusCode).toBe(
    200,
  );
  await expect(
    checkPlacement(pool, actor("member"), world(), { qx: 0, qy: 0 }),
  ).resolves.toBeTruthy();
  await expect(
    admissionCommand(
      pool,
      config,
      actor("member"),
      world(),
      cmd("IssueInvitation") as never,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  // Moderation alone allows invitations but not project creation.
  expect((await grant({ ...none, canModerate: true })).statusCode).toBe(200);
  await expect(
    admissionCommand(
      pool,
      config,
      actor("member"),
      world(),
      cmd("IssueInvitation") as never,
    ),
  ).resolves.toBeTruthy();
  await expect(
    checkPlacement(pool, actor("member"), world(), { qx: 0, qy: 0 }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  // A moderator cannot ban the creator or another moderator, nor widen permissions.
  const creatorMember = (
    await pool.query(
      "SELECT id,revision FROM wf2_memberships WHERE person_id=$1",
      [actor("owner").id],
    )
  ).rows[0];
  await expect(
    admissionCommand(
      pool,
      config,
      actor("member"),
      world(),
      cmd("BanMember", {
        memberId: creatorMember.id,
        expectedMembershipRevision: String(creatorMember.revision),
      }) as never,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (
      await call("PUT", path, "member", {
        expectedMembershipRevision: "1",
        permissions: { ...none, canModerate: true },
      })
    ).statusCode,
  ).toBe(403);
  // Validation: all four booleans required; stale revisions rejected; the creator is not a target.
  expect(
    (
      await call("PUT", path, "owner", {
        expectedMembershipRevision: "1",
        permissions: { canModerate: true },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await call("PUT", path, "owner", {
        expectedMembershipRevision: "1",
        permissions: none,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call(
        "GET",
        "/api/worlds/" +
          world() +
          "/members/" +
          creatorMember.id +
          "/permissions",
        "owner",
      )
    ).statusCode,
  ).toBe(404);
  // Leaving revokes every delegated permission together with view access.
  await admissionCommand(
    pool,
    config,
    actor("member"),
    world(),
    cmd("LeaveCommunity") as never,
  );
  expect(await membership("member")).toMatchObject({
    state: "left",
    can_view: false,
    can_moderate: false,
    can_create_projects: false,
    can_manage_construction: false,
  });
});

it("F4: the database refuses permissions without view access", async () => {
  await expect(
    pool.query(
      "UPDATE wf2_world_grants SET can_moderate=true WHERE world_id=$1 AND person_id=$2",
      [world(), actor("member").id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
});

it("F4: optional follow authorization binds to the starting session, the same account and the granted scope", async () => {
  const start = await call("GET", "/auth/twitch/follows", "pending");
  expect(start.statusCode).toBe(302);
  const target = new URL(String(start.headers.location));
  expect(target.origin + target.pathname).toBe(
    "https://id.twitch.tv/oauth2/authorize",
  );
  expect(target.searchParams.get("scope")).toBe(FOLLOW);
  const state = target.searchParams.get("state")!;
  const cookie = (name: string) =>
    start.cookies.find((c) => c.name === name)!.value;
  expect((await call("GET", "/auth/twitch/follows")).statusCode).toBe(404);
  const callback = (code: string, role: string | null, st = state) =>
    app.inject({
      remoteAddress: ip(),
      url: "/auth/twitch/callback?code=" + code + "&state=" + st,
      headers: {
        cookie:
          "cv_oauth_state=" +
          cookie("cv_oauth_state") +
          (role ? "; cv_session=" + actor(role).raw : ""),
      },
    });
  // Another session cannot complete the flow; the state is single-use.
  const wrongSession = await callback("pending", "owner");
  expect(wrongSession.headers.location).toContain("follows=failed");
  expect((await callback("pending", "pending")).statusCode).toBe(400);
  const scopeOf = async (role: string) =>
    (
      await pool.query(
        "SELECT granted_scopes FROM sessions WHERE session_hash=$1",
        [actor(role).session_hash],
      )
    ).rows[0].granted_scopes;
  expect(await scopeOf("pending")).toEqual([FOLLOW]); // granted earlier in this file
  await pool.query(
    "UPDATE sessions SET granted_scopes='{}' WHERE session_hash=$1",
    [actor("pending").session_hash],
  );
  // Different Twitch account in the consent screen.
  scopesFor.owner = [FOLLOW];
  const s2 = await call("GET", "/auth/twitch/follows", "pending");
  const st2 = new URL(String(s2.headers.location)).searchParams.get("state")!;
  const mismatch = await app.inject({
    remoteAddress: ip(),
    url: "/auth/twitch/callback?code=owner&state=" + st2,
    headers: {
      cookie:
        "cv_oauth_state=" +
        s2.cookies.find((c) => c.name === "cv_oauth_state")!.value +
        "; cv_session=" +
        actor("pending").raw,
    },
  });
  expect(mismatch.headers.location).toContain("follows=declined");
  expect(await scopeOf("pending")).toEqual([]);
  // User deselects the scope.
  scopesFor.pending = [];
  const s3 = await call("GET", "/auth/twitch/follows", "pending");
  const st3 = new URL(String(s3.headers.location)).searchParams.get("state")!;
  const declinedScope = await app.inject({
    remoteAddress: ip(),
    url: "/auth/twitch/callback?code=pending&state=" + st3,
    headers: {
      cookie:
        "cv_oauth_state=" +
        s3.cookies.find((c) => c.name === "cv_oauth_state")!.value +
        "; cv_session=" +
        actor("pending").raw,
    },
  });
  expect(declinedScope.headers.location).toContain("follows=declined");
  expect(await scopeOf("pending")).toEqual([]);
  // Granted.
  scopesFor.pending = [FOLLOW];
  const s4 = await call("GET", "/auth/twitch/follows", "pending");
  const st4 = new URL(String(s4.headers.location)).searchParams.get("state")!;
  const granted = await app.inject({
    remoteAddress: ip(),
    url: "/auth/twitch/callback?code=pending&state=" + st4,
    headers: {
      cookie:
        "cv_oauth_state=" +
        s4.cookies.find((c) => c.name === "cv_oauth_state")!.value +
        "; cv_session=" +
        actor("pending").raw,
    },
  });
  expect(granted.headers.location).toBe(
    ui2Origin + "/communities?follows=connected",
  );
  expect(await scopeOf("pending")).toEqual([FOLLOW]);
  // The default sign-in is untouched: still scope-free.
  const login = await call("GET", "/auth/twitch");
  expect(
    new URL(String(login.headers.location)).searchParams.get("scope"),
  ).toBe("");
});

it("F4: provider failures degrade safely; revoked authorization drops the scope; disconnect keeps membership", async () => {
  await grantScope("owner");
  await resetCooldown("pending");
  failFollowWith = 503;
  const down = await call(
    "POST",
    "/api/communities/follows/refresh",
    "pending",
  );
  expect(down.statusCode).toBe(503);
  expect(down.json().error.code).toBe("PROVIDER_UNAVAILABLE");
  failFollowWith = 401;
  await resetCooldown("pending");
  const revoked = await call(
    "POST",
    "/api/communities/follows/refresh",
    "pending",
  );
  expect(revoked.statusCode).toBe(403);
  expect(revoked.json().error.code).toBe("RECONNECT_REQUIRED");
  failFollowWith = null;
  expect(
    (await call("GET", "/api/communities", "pending")).json().followDiscovery
      .status,
  ).toBe("not-connected");
  const before = await membership("empty");
  await grantScope("empty");
  const off = await call(
    "POST",
    "/api/communities/follows/disconnect",
    "empty",
  );
  expect(off.statusCode).toBe(200);
  expect(await membership("empty")).toEqual(before);
});

it("F4: disabling follower joining hides the village immediately without removing members", async () => {
  await configure(true, 50);
  follows.set("ui2-pending", ["ui2-owner"]);
  await call("GET", "/auth/twitch/follows", "pending"); // no-op; scope may be dropped by previous test
  await grantScope("pending");
  await resetCooldown("pending");
  expect(
    (await call("POST", "/api/communities/follows/refresh", "pending")).json()
      .villages,
  ).toHaveLength(1);
  await configure(false, 50);
  expect(
    (await call("GET", "/api/communities", "pending")).json().followDiscovery
      .villages,
  ).toEqual([]);
  expect(
    (
      await call("POST", "/api/communities/follows/join", "pending", {
        worldId: world(),
      })
    ).statusCode,
  ).toBe(404);
  expect(followCalls).toBeGreaterThan(0);
});
