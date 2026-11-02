import { beforeAll, afterAll, expect, it } from "vitest";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import { admissionCommand } from "../apps/server/src/participation-admission.js";
import { randomUUID } from "node:crypto";
import { seedUi2, ui2Key, ui2Origin } from "../scripts/ui2-fixture.mjs";
import { requestView, appendJoined } from "../apps/web/src/community-view.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.port !== "55439")
  throw Error("UI-2 tests require task-owned PG55439");
const admin = createPool(url.toString());
url.pathname = "/creators_village_ui2_test";
const pool = createPool(url.toString());
let fixture: Awaited<ReturnType<typeof seedUi2>>,
  app: Awaited<ReturnType<typeof buildApp>>;
const config = {
  databaseUrl: url.toString(),
  clientId: "synthetic",
  clientSecret: "unused",
  redirectUri: ui2Origin + "/auth/twitch/callback",
  webOrigin: ui2Origin,
  encryptionKey: ui2Key,
  secureCookies: false,
  production: true,
  wf2WorldId: "",
};
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_ui2_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people CASCADE");
  fixture = await seedUi2(pool, 19);
  config.wf2WorldId = fixture.mainWorld;
  app = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async (role) => {
      const a = fixture.actors[role];
      if (!a) throw Error("unknown");
      return {
        subject: "ui2-" + role,
        displayName: a.name,
        login: "ui2_" + role,
      };
    },
  });
}, 30000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
function get(path: string, role?: string) {
  return app.inject({
    url: path,
    headers: role ? { cookie: "cv_session=" + fixture.actors[role].raw } : {},
  });
}
it("UI2: creator identity is returned only for owned or approved community entries", async () => {
  expect((await get("/api/communities")).statusCode).toBe(401);
  expect((await get("/__ui2/review/owner")).statusCode).toBe(404);
  expect((await get("/scripts/ui2-review-server.mjs")).statusCode).toBe(404);
  const r = await get("/api/communities", "owner"),
    data = r.json();
  expect(r.statusCode).toBe(200);
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(data.own.map((w: any) => w.id).sort()).toEqual(
    [fixture.mainWorld, fixture.legacyWorld].sort(),
  );
  expect(data.own.every((w: any) => w.creatorDisplayName === "Mira Vale")).toBe(
    true,
  );
  expect(data.joined).toHaveLength(1);
  expect(data.joined[0].creatorDisplayName).toBe("Sol Finch");
  expect(data.creation.allowed).toBe(false);
  expect(data.followDiscovery.status).toBe("not-connected");
  expect(r.body).not.toMatch(
    /csrf|encrypted_tokens|twitch_subject|twitch_login|session_hash/,
  );
  const publicEntry = await get(
    "/api/worlds/" + fixture.legacyWorld + "/entry",
  );
  expect(publicEntry.json().creatorDisplayName).toBeUndefined();
});
it("UI2: pending, rejected, left and unrelated actors see no private community metadata or entry", async () => {
  for (const role of ["pending", "denied", "lost", "empty"]) {
    const r = await get("/api/communities", role);
    expect(r.json().own).toEqual([]);
    expect(r.json().joined).toEqual([]);
    expect(r.body).not.toMatch(
      /Willow Workshop|Mira Vale|Juniper Hollow|Sol Finch/,
    );
    expect(
      (await get("/api/worlds/" + fixture.mainWorld + "/entry", role))
        .statusCode,
    ).toBe(404);
    expect(
      (await get("/api/wf2/worlds/" + fixture.mainWorld + "/bootstrap", role))
        .statusCode,
    ).toBe(404);
  }
});
it("UI2: real PostgreSQL pagination retains exact authorized IDs without duplicates", async () => {
  const first = (await get("/api/communities", "member")).json();
  expect(first.joined).toHaveLength(20);
  expect(first.nextJoinedCursor).toBeTruthy();
  const second = (
    await get("/api/communities?after=" + first.nextJoinedCursor, "member")
  ).json();
  expect(second.joined).toHaveLength(1);
  expect(second.nextJoinedCursor).toBeNull();
  const all = appendJoined(first.joined, [first.joined[0], ...second.joined]);
  expect(all).toHaveLength(21);
  expect(new Set(all.map((w) => w.id)).size).toBe(21);
  expect(all.every((w) => w.creatorDisplayName)).toBe(true);
});
it("UI2: historical approval cannot produce an approved or enterable current status after leaving", async () => {
  const me = (await get("/api/wf2/me", "lost")).json();
  expect(me.requests[0].state).toBe("approved");
  expect(me.grants).toEqual([]);
  expect(requestView(me.requests[0], me.grants)).toMatchObject({
    enter: false,
    label: "Access unavailable",
  });
  for (const [role, label] of [
    ["pending", "Request pending"],
    ["denied", "Not authorized"],
  ]) {
    const state = (await get("/api/wf2/me", role)).json();
    expect(requestView(state.requests[0], state.grants)).toMatchObject({
      label,
      enter: false,
    });
  }
});
it("UI2: invitation readiness requires the actual continuation cookie and an unexpired server record", async () => {
  const c = fixture.invitation.continuation,
    path = "/api/wf2/join/continuations/" + c.continuationId;
  expect((await get(path, "invited")).statusCode).not.toBe(200);
  const headers = {
    cookie:
      "cv_session=" + fixture.actors.invited.raw + "; cv_join=" + c.cookie,
  };
  const ready = await app.inject({ url: path, headers });
  expect(ready.statusCode).toBe(200);
  expect(ready.json().confirmed).toBe(false);
  await pool.query(
    "UPDATE wf2_join_continuations SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [c.continuationId],
  );
  expect((await app.inject({ url: path, headers })).statusCode).toBe(410);
});
it("UI2: current membership revocation removes creator labels as well as entry permission", async () => {
  const member = fixture.actors.member;
  await admissionCommand(pool, config, member, fixture.mainWorld, {
    commandSchema: "wf2-command-1",
    commandId: randomUUID(),
    kind: "LeaveCommunity",
    payload: {},
  });
  const response = await get("/api/communities", "member");
  expect(
    response.json().joined.some((w: any) => w.id === fixture.mainWorld),
  ).toBe(false);
  expect(response.body).not.toContain("Mira Vale");
  expect(
    (await get("/api/worlds/" + fixture.mainWorld + "/entry", "member"))
      .statusCode,
  ).toBe(404);
});
