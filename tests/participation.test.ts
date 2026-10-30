import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createPool, migrate } from "../apps/server/src/database.js";
import { buildApp } from "../apps/server/src/app.js";
import { publishFounding } from "../apps/server/src/founding.js";
import { generateBaseline } from "../packages/world/src/founding.js";
import { generateWorld } from "../packages/world/src/index.js";
import { hash, encrypt, randomToken } from "../apps/server/src/security.js";
import type { Config } from "../apps/server/src/config.js";
import {
  replay,
  pruneReplay,
  streamDiagnostics,
} from "../apps/server/src/participation-events.js";
import {
  projectCommand,
  leaseCompletion,
  completeConstruction,
} from "../apps/server/src/participation-projects.js";
import { bootstrap } from "../apps/server/src/participation-core.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf2_test";
const pool = createPool(url.toString()),
  world = randomUUID(),
  owner = randomUUID(),
  outsider = randomUUID();
const config: Config = {
  databaseUrl: url.toString(),
  clientId: "test",
  clientSecret: "test",
  redirectUri: "http://localhost:3000/auth/twitch/callback",
  webOrigin: "http://localhost:5173",
  encryptionKey: "d".repeat(64),
  secureCookies: false,
  wf2WorldId: world,
};
let app: Awaited<ReturnType<typeof buildApp>>,
  headers: Record<string, string>,
  foreign: Record<string, string>,
  baselineHash: string,
  original: string;
export async function identity(id: string) {
  const raw = randomToken(),
    csrf = randomToken();
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4)",
    [id, randomUUID(), "Test person", "test_person"],
  );
  await pool.query(
    "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '1 day')",
    [
      hash(raw),
      id,
      csrf,
      encrypt(
        { access_token: "fake", refresh_token: "fake", expires_in: 7200 },
        config.encryptionKey,
      ),
    ],
  );
  return {
    cookie: "cv_session=" + raw,
    origin: config.webOrigin,
    "x-csrf-token": csrf,
  };
}
async function signature() {
  return hash(
    JSON.stringify(
      (
        await pool.query(
          "SELECT w.header,w.baseline_hash,(SELECT jsonb_agg(to_jsonb(c)-'revision' ORDER BY c.y,c.x) FROM founding_chunks c WHERE c.world_id=w.id) AS chunks,(SELECT jsonb_agg(to_jsonb(s)) FROM founding_structures s WHERE s.world_id=w.id AND s.id='founding-shelter') AS founder FROM founding_worlds w WHERE w.id=$1",
          [world],
        )
      ).rows,
    ),
  );
}
const command = (
  kind: string,
  payload: object = {},
  commandId = randomUUID(),
) => ({ commandSchema: "wf2-command-1", commandId, kind, payload });
const send = (body: object, h = headers) =>
  app.inject({
    method: "POST",
    url: `/api/wf2/worlds/${world}/commands`,
    headers: h,
    payload: body,
  });
async function invite() {
  const r = await send(command("IssueInvitation"));
  expect(r.statusCode).toBe(200);
  const id = r.json().result.inviteId;
  const link = await app.inject({
    url: `/api/wf2/worlds/${world}/invitations/${id}/link`,
    headers,
  });
  expect(link.statusCode).toBe(200);
  const again = await app.inject({
    url: `/api/wf2/worlds/${world}/invitations/${id}/link`,
    headers,
  });
  expect(again.json()).toEqual(link.json());
  return { id, token: link.json().url.split("=")[1] };
}
async function continuation(token: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/wf2/join/continuations",
    headers: { origin: config.webOrigin, "x-wf2-join": "1" },
    payload: { token },
  });
  expect(r.statusCode).toBe(200);
  return {
    id: r.json().continuationId,
    cookie: ([r.headers["set-cookie"]].flat()[0] as string).split(";")[0]!,
  };
}
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_wf2_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people,wf2_operational_logs CASCADE");
  headers = await identity(owner);
  foreign = await identity(outsider);
  const legacy = generateWorld("fern", {
    id: randomUUID(),
    name: "Legacy test",
    createdAt: new Date().toISOString(),
    source: "creator",
  });
  await pool.query(
    "INSERT INTO worlds(id,creator_id,name,seed,generator_version,asset_version,schema_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
    [
      legacy.id,
      owner,
      legacy.name,
      legacy.seed,
      legacy.generatorVersion,
      legacy.assetVersion,
      legacy,
    ],
  );
  const job = randomUUID(),
    lease = new Date(Date.now() + 30000).toISOString();
  await pool.query(
    "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,'Test clearing','fern','development','working',$6)",
    [job, owner, randomUUID(), hash("fixture"), world, lease],
  );
  const baseline = generateBaseline("fern");
  baselineHash = baseline.hash;
  await publishFounding(pool, job, baseline, lease);
  original = await signature();
  app = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      throw Error("unused");
    },
  });
}, 30000);
afterAll(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
it("PI1: community readers reveal only owned and approved worlds; identity-only follows remain disconnected", async () => {
  expect((await app.inject({ url: "/api/communities" })).statusCode).toBe(401);
  const own = await app.inject({ url: "/api/communities", headers });
  expect(own.statusCode).toBe(200);
  expect(own.headers["cache-control"]).toBe("no-store");
  expect(
    own
      .json()
      .own.map((w: any) => w.version)
      .sort(),
  ).toEqual([1, 2]);
  expect(own.json().joined).toEqual([]);
  expect(own.json().followDiscovery).toEqual({
    status: "not-connected",
    requiredScope: "user:read:follows",
  });
  expect(own.json().creation).toMatchObject({
    allowed: false,
    reason: "private-playtest",
  });
  const other = await app.inject({ url: "/api/communities", headers: foreign });
  expect(other.json().own).toEqual([]);
  expect(other.json().joined).toEqual([]);
  expect(
    (
      await app.inject({
        url: "/api/worlds/" + world + "/entry",
        headers: foreign,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({ url: "/api/worlds/" + world + "/entry", headers })
    ).json(),
  ).toMatchObject({
    version: 2,
    reader: "participation",
    capabilities: { enable: true, plan: false },
  });
  expect(
    (await app.inject({ url: "/api/communities?after=invalid", headers }))
      .statusCode,
  ).toBe(400);
  const sample = await app.inject({ url: "/api/worlds/showcase-fern/entry" });
  expect(sample.json()).toMatchObject({
    source: "showcase",
    isCreator: false,
    capabilities: { contribute: false },
  });
  const authorization = await app.inject({ url: "/auth/twitch" });
  expect(
    new URL(authorization.headers.location!).searchParams.get("scope"),
  ).toBe("");
  expect(own.body).not.toMatch(
    /twitch_subject|csrf|encrypted_tokens|twitch_login/,
  );
});
it("A06/A07: owner-only configured development activation is idempotent, claims copy exactly, no baseline changes", async () => {
  const body = command("EnablePlaytest", {
    expectedBaselineHash: baselineHash,
  });
  expect((await send(body, foreign)).statusCode).toBe(404);
  const results = await Promise.all([send(body), send(body)]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(results[0]!.json()).toEqual(results[1]!.json());
  expect(
    (await pool.query("SELECT count(*)::int n FROM wf2_bindings")).rows[0].n,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_claims c JOIN founding_occupancy o USING(world_id,surface,hx,hy,structure_id) WHERE c.kind='solid'",
      )
    ).rows[0].n,
  ).toBe(24);
  expect(await signature()).toBe(original);
});
it("A04/A05: current reader is scoped, old mutable viewer fails explicitly, write disable retains facts", async () => {
  const get = (h: Record<string, string>) =>
    app.inject({ url: `/api/wf2/worlds/${world}/bootstrap`, headers: h });
  expect((await get(foreign)).statusCode).toBe(404);
  const r = await get(headers);
  expect(r.statusCode).toBe(200);
  expect(r.json().stateSchema).toBe("wf2-state-1");
  expect(r.json().structures).toHaveLength(1);
  expect(r.json().cursor).toBe("1");
  const old = await app.inject({ url: "/api/founding/" + world, headers });
  expect(old.statusCode).toBe(409);
  expect(old.json().error.code).toBe("CLIENT_UPDATE_REQUIRED");
});
it("A08/F04: unknown fields and unsupported commands rejected, new onboarding stays closed", async () => {
  const bad = await send({ ...command("IssueInvitation"), personId: outsider });
  expect(bad.statusCode).toBe(400);
  const r = await app.inject({
    method: "POST",
    url: "/api/founding",
    headers: foreign,
    payload: {
      commandId: randomUUID(),
      name: "Not another world",
      seed: "fern",
      development: false,
    },
  });
  expect(r.statusCode).toBe(403);
  expect(r.json().error.code).toBe("ONBOARDING_CLOSED");
});
it("A05/A06/B10: write feature-off, wrong purpose/world, creator self-removal and unknown references fail safely", async () => {
  const { wf2WorldId: _world, ...offConfig } = config;
  const off = await buildApp(offConfig, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      throw Error("unused");
    },
  });
  try {
    const r = await off.inject({
      method: "POST",
      url: `/api/wf2/worlds/${world}/commands`,
      headers,
      payload: command("IssueInvitation"),
    });
    expect(r.statusCode).toBe(404);
    expect(
      (await off.inject({ url: `/api/wf2/worlds/${world}/bootstrap`, headers }))
        .statusCode,
    ).toBe(200);
  } finally {
    await off.close();
  }
  const ownerMember = (
    await pool.query("SELECT id FROM wf2_memberships WHERE person_id=$1", [
      owner,
    ])
  ).rows[0].id;
  expect((await send(command("LeaveCommunity"))).statusCode).toBe(403);
  expect(
    (
      await send(
        command("BanMember", {
          memberId: ownerMember,
          expectedMembershipRevision: "1",
        }),
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await send(
        command("ApproveRequest", {
          requestId: randomUUID(),
          expectedRequestRevision: "1",
        }),
      )
    ).statusCode,
  ).toBe(404);
  await pool.query("UPDATE founding_worlds SET purpose='active' WHERE id=$1", [
    world,
  ]);
  try {
    expect(
      (
        await send(
          command("EnablePlaytest", { expectedBaselineHash: baselineHash }),
        )
      ).statusCode,
    ).toBe(404);
  } finally {
    await pool.query(
      "UPDATE founding_worlds SET purpose='development' WHERE id=$1",
      [world],
    );
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/wf2/worlds/${randomUUID()}/commands`,
        headers,
        payload: command("IssueInvitation"),
      })
    ).statusCode,
  ).toBe(404);
  const unknown = await app.inject({
    url: "/api/wf2/not-a-route?private=do-not-echo",
    headers,
  });
  expect(unknown.body).not.toContain("do-not-echo");
  expect(unknown.headers["cache-control"]).toBe("no-store");
  const saved = (
    await pool.query("SELECT header FROM founding_worlds WHERE id=$1", [world])
  ).rows[0].header;
  await pool.query(
    "UPDATE founding_worlds SET header=jsonb_set(header,'{baseline,seed}',$2::jsonb) WHERE id=$1",
    [world, JSON.stringify("corrupted-fixture")],
  );
  try {
    const bad = await app.inject({
      url: `/api/wf2/worlds/${world}/bootstrap`,
      headers,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("UNSUPPORTED_SCHEMA");
  } finally {
    await pool.query("UPDATE founding_worlds SET header=$2 WHERE id=$1", [
      world,
      saved,
    ]);
  }
  expect(await signature()).toBe(original);
});
it("E11: a shared IP does not spend another authenticated account budget; random cookies cannot evade the anonymous budget", async () => {
  const isolated = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      throw Error("unused");
    },
  });
  try {
    for (let i = 0; i < 120; i++)
      expect(
        (await isolated.inject({ url: "/api/wf2/me", headers })).statusCode,
      ).toBe(200);
    expect(
      (await isolated.inject({ url: "/api/wf2/me", headers })).statusCode,
    ).toBe(429);
    expect(
      (await isolated.inject({ url: "/api/wf2/me", headers: foreign }))
        .statusCode,
    ).toBe(200);
    for (let i = 0; i < 120; i++)
      expect((await isolated.inject({ url: "/api/wf2/me" })).statusCode).toBe(
        403,
      );
    for (let i = 0; i < 5; i++)
      expect(
        (
          await isolated.inject({
            url: "/api/wf2/me",
            headers: { cookie: "cv_session=" + randomToken() },
          })
        ).statusCode,
      ).toBe(429);
  } finally {
    await isolated.close();
  }
});
let memberHeaders: Record<string, string>, memberId: string, requestId: string;
it("B02–B05: link retrieval/prefetch grants nothing; two accounts race one explicit request; lost response retries", async () => {
  const i = await invite(),
    c1 = await continuation(i.token),
    c2 = await continuation(i.token);
  const loser = await identity(randomUUID());
  const b1 = command("RequestJoin", { continuationId: c1.id }),
    b2 = command("RequestJoin", { continuationId: c2.id });
  const r = await Promise.all([
    app.inject({
      method: "POST",
      url: "/api/wf2/join/commands",
      headers: { ...foreign, cookie: foreign.cookie + "; " + c1.cookie },
      payload: b1,
    }),
    app.inject({
      method: "POST",
      url: "/api/wf2/join/commands",
      headers: { ...loser, cookie: loser.cookie + "; " + c2.cookie },
      payload: b2,
    }),
  ]);
  expect(r.map((v) => v.statusCode).sort()).toEqual([200, 409]);
  const win = r[0]!.statusCode === 200 ? 0 : 1;
  memberHeaders = win === 0 ? foreign : loser;
  const body = win === 0 ? b1 : b2;
  requestId = r[win]!.json().result.requestId;
  const retry = await app.inject({
    method: "POST",
    url: "/api/wf2/join/commands",
    headers: memberHeaders,
    payload: body,
  });
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toEqual(r[win]!.json());
  const changed = await app.inject({
    method: "POST",
    url: "/api/wf2/join/commands",
    headers: memberHeaders,
    payload: { ...body, payload: { continuationId: randomUUID() } },
  });
  expect(changed.statusCode).toBe(409);
  expect(changed.json().error.code).toBe("COMMAND_ID_REUSED");
  expect(
    (
      await app.inject({
        url: `/api/wf2/worlds/${world}/bootstrap`,
        headers: memberHeaders,
      })
    ).statusCode,
  ).toBe(404);
  const stored = await pool.query(
    "SELECT result::text FROM wf2_command_receipts",
  );
  expect(JSON.stringify(stored.rows)).not.toContain(i.token);
  const row = (
    await pool.query("SELECT sealed_token FROM wf2_invitations WHERE id=$1", [
      i.id,
    ])
  ).rows[0];
  expect(row.sealed_token).toBeNull();
});
it("B07/B08/B10: creator explicit approval yields scoped access and minimum identity only", async () => {
  const list = await app.inject({
    url: `/api/wf2/worlds/${world}/admission`,
    headers,
  });
  expect(list.statusCode).toBe(200);
  expect(JSON.stringify(list.json())).not.toContain("twitch_subject");
  expect(
    (
      await app.inject({
        url: `/api/wf2/worlds/${world}/admission`,
        headers: memberHeaders,
      })
    ).statusCode,
  ).toBe(404);
  const a = await send(
    command("ApproveRequest", { requestId, expectedRequestRevision: "1" }),
  );
  expect(a.statusCode).toBe(200);
  memberId = a.json().result.memberId;
  expect(
    (
      await app.inject({
        url: `/api/wf2/worlds/${world}/bootstrap`,
        headers: memberHeaders,
      })
    ).statusCode,
  ).toBe(200);
});
it("PI1: approved membership is separate from follows; revocation removes entry without a founding fallback", async () => {
  const before = await app.inject({
    url: "/api/communities",
    headers: memberHeaders,
  });
  expect(before.json().joined.map((w: any) => w.id)).toContain(world);
  expect(before.json().own).toEqual([]);
  const entry = await app.inject({
    url: "/api/worlds/" + world + "/entry",
    headers: memberHeaders,
  });
  expect(entry.json()).toMatchObject({
    isCreator: false,
    capabilities: { contribute: true, plan: false, admit: false },
  });
  await pool.query(
    "UPDATE wf2_world_grants SET can_view=false,can_contribute=false WHERE world_id=$1 AND person_id=(SELECT person_id FROM wf2_memberships WHERE id=$2)",
    [world, memberId],
  );
  try {
    expect(
      (
        await app.inject({
          url: "/api/worlds/" + world + "/entry",
          headers: memberHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({ url: "/api/communities", headers: memberHeaders })
      ).json().joined,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          url: "/api/founding/" + world,
          headers: memberHeaders,
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await pool.query(
      "UPDATE wf2_world_grants SET can_view=true,can_contribute=true WHERE world_id=$1 AND person_id=(SELECT person_id FROM wf2_memberships WHERE id=$2)",
      [world, memberId],
    );
  }
  expect(await signature()).toBe(original);
});
let projectId: string, planHash: string;
it("D02/D04/D06–D08: drafts reserve nothing, publication freezes exact plan and one active slot", async () => {
  const invalid = await send(
    command("CreateDraft", { site: { qx: 0, qy: 0 } }),
  );
  expect(invalid.statusCode).toBe(400);
  const draft = await send(
    command("CreateDraft", { site: { qx: 1792, qy: 1280 } }),
  );
  expect(draft.statusCode, draft.body).toBe(200);
  projectId = draft.json().result.projectId;
  planHash = draft.json().result.planHash;
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_claims WHERE kind='reserved'",
      )
    ).rows[0].n,
  ).toBe(0);
  const publish = await send(
    command("PublishProject", {
      projectId,
      expectedProjectRevision: "1",
      planHash,
    }),
  );
  expect(publish.statusCode, publish.body).toBe(200);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_claims WHERE kind='reserved'",
      )
    ).rows[0].n,
  ).toBe(144);
  expect(
    (
      await send(
        command("ReviseDraft", {
          projectId,
          expectedProjectRevision: "2",
          site: { qx: -1792, qy: 1280 },
        }),
      )
    ).statusCode,
  ).toBe(409);
  await expect(
    pool.query("UPDATE wf2_projects SET qx=qx+128 WHERE id=$1", [projectId]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("F01–F03/F05/F08/F13/F14: two independent accepted actions, immutable retries, automatic atomic same-world completion", async () => {
  const body = command("Contribute", {
    projectId,
    planHash,
    recognitionOptIn: false,
  });
  const r = await Promise.all([send(body), send(body)]);
  expect(r.map((v) => v.statusCode)).toEqual([200, 200]);
  expect(r[0]!.json()).toEqual(r[1]!.json());
  expect(
    (
      await send(
        command("Contribute", { projectId, planHash, recognitionOptIn: true }),
      )
    ).json().error.code,
  ).toBe("ALREADY_CONTRIBUTED");
  const entrants = [memberHeaders],
    community = (
      await pool.query(
        "SELECT community_id FROM wf2_bindings WHERE world_id=$1",
        [world],
      )
    ).rows[0].community_id;
  for (let i = 0; i < 2; i++) {
    const person = randomUUID();
    entrants.push(await identity(person));
    await pool.query(
      "INSERT INTO wf2_memberships(id,community_id,person_id,state,revision) VALUES($1,$2,$3,'active',2)",
      [randomUUID(), community, person],
    );
    await pool.query(
      "INSERT INTO wf2_world_grants(world_id,community_id,person_id,can_view,can_contribute) VALUES($1,$2,$3,true,true)",
      [world, community, person],
    );
  }
  const competing = await Promise.all(
    entrants.map((h) =>
      send(
        command("Contribute", { projectId, planHash, recognitionOptIn: false }),
        h,
      ),
    ),
  );
  expect(competing.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  const winner = competing.findIndex((r) => r.statusCode === 200);
  memberHeaders = entrants[winner]!;
  memberId = (
    await pool.query(
      "SELECT m.id FROM wf2_memberships m JOIN sessions s ON s.person_id=m.person_id WHERE s.session_hash=$1 AND m.community_id=$2",
      [hash(memberHeaders.cookie!.split("=")[1]!), community],
    )
  ).rows[0].id;
  for (let i = 0; i < entrants.length; i++)
    if (i !== winner)
      expect(
        (await send(command("LeaveCommunity"), entrants[i])).statusCode,
      ).toBe(200);
  const final = competing[winner]!;
  expect(final.statusCode, final.body).toBe(200);
  expect(final.json().result.completionQueued).toBe(true);
  for (let n = 0; n < 100; n++) {
    if (
      (await pool.query("SELECT count(*)::int n FROM wf2_completion_results"))
        .rows[0].n === 1
    )
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const state = await app.inject({
    url: `/api/wf2/worlds/${world}/bootstrap`,
    headers: memberHeaders,
  });
  expect(state.statusCode).toBe(200);
  expect(state.json().structures).toHaveLength(2);
  expect(state.json().paths).toHaveLength(2);
  expect(state.json().projects[0].state).toBe("completed");
  expect(
    (
      await send(
        command("CancelProject", {
          projectId,
          expectedProjectRevision: state.json().projects[0].revision,
        }),
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_contributions WHERE project_id=$1",
        [projectId],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(await signature()).toBe(original);
  expect((await send(body)).json()).toEqual(r[0]!.json());
});
it("C01–C04/B09: credit default private, scoped opt-in, ban suppresses it without falsifying work; own withdrawal survives", async () => {
  const get = () =>
    app.inject({
      url: `/api/wf2/worlds/${world}/projects/${projectId}/credits`,
      headers,
    });
  expect((await get()).json().credits).toEqual([]);
  expect(
    (
      await send(
        command("SetRecognition", { projectId, optedIn: true }),
        memberHeaders,
      )
    ).statusCode,
  ).toBe(200);
  expect((await get()).json().credits).toHaveLength(1);
  expect(
    (
      await send(
        command("BanMember", { memberId, expectedMembershipRevision: "2" }),
      )
    ).statusCode,
  ).toBe(200);
  expect((await get()).json().credits).toHaveLength(0);
  expect(
    (
      await app.inject({
        url: `/api/wf2/worlds/${world}/bootstrap`,
        headers: memberHeaders,
      })
    ).statusCode,
  ).toBe(404);
  const withdraw = await app.inject({
    method: "POST",
    url: "/api/wf2/privacy/commands",
    headers: memberHeaders,
    payload: command("SetRecognition", { projectId, optedIn: false }),
  });
  expect(withdraw.statusCode).toBe(200);
  expect(
    (
      await pool.query("SELECT accepted_count FROM wf2_projects WHERE id=$1", [
        projectId,
      ])
    ).rows[0].accepted_count,
  ).toBe(2);
  expect(
    (
      await send(
        command("UnbanMember", { memberId, expectedMembershipRevision: "3" }),
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: `/api/wf2/worlds/${world}/bootstrap`,
        headers: memberHeaders,
      })
    ).statusCode,
  ).toBe(404);
});
it("B06/B09: expired/revoked links never grant, unbanned account still needs fresh request/approval", async () => {
  const fresh = await invite();
  const context = await continuation(fresh.token);
  for (const [id, cookie] of [
    [context.id, "cv_join=" + randomToken()],
    [randomUUID(), context.cookie],
  ]) {
    const forged = await app.inject({
      method: "POST",
      url: "/api/wf2/join/commands",
      headers: {
        ...memberHeaders,
        cookie: memberHeaders.cookie + "; " + cookie,
      },
      payload: command("RequestJoin", { continuationId: id }),
    });
    expect(forged.statusCode).toBe(410);
  }
  const oauth = await app.inject({
    url: "/auth/twitch?redirect_uri=https://untrusted.example&resume=https://untrusted.example",
    headers: { cookie: context.cookie },
  });
  expect(oauth.statusCode).toBe(302);
  const authorization = new URL(oauth.headers.location!);
  expect(authorization.origin).toBe("https://id.twitch.tv");
  expect(authorization.searchParams.get("redirect_uri")).toBe(
    config.redirectUri,
  );
  expect(authorization.toString()).not.toContain(fresh.token);
  expect(authorization.toString()).not.toContain(context.id);
  const badCallback = await app.inject({
    url: "/auth/twitch/callback?state=forged&code=fake&resume=https://untrusted.example",
    headers: { cookie: "cv_oauth_state=different" },
  });
  expect(badCallback.statusCode).toBe(400);
  const expired = await invite();
  await pool.query(
    "UPDATE wf2_invitations SET created_at=created_at-interval '25 hours',expires_at=expires_at-interval '25 hours' WHERE id=$1",
    [expired.id],
  );
  const init = await app.inject({
    method: "POST",
    url: "/api/wf2/join/continuations",
    headers: { origin: config.webOrigin, "x-wf2-join": "1" },
    payload: { token: expired.token },
  });
  expect(init.statusCode).toBe(410);
  const i = await invite(),
    c = await continuation(i.token),
    body = command("RequestJoin", { continuationId: c.id });
  const join = await app.inject({
    method: "POST",
    url: "/api/wf2/join/commands",
    headers: {
      ...memberHeaders,
      cookie: memberHeaders.cookie + "; " + c.cookie,
    },
    payload: body,
  });
  expect(join.statusCode).toBe(200);
  const approval = await send(
    command("ApproveRequest", {
      requestId: join.json().result.requestId,
      expectedRequestRevision: "1",
    }),
  );
  expect(approval.statusCode).toBe(200);
  const revoked = await invite();
  expect(
    (await send(command("RevokeInvitation", { inviteId: revoked.id })))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/wf2/join/continuations",
        headers: { origin: config.webOrigin, "x-wf2-join": "1" },
        payload: { token: revoked.token },
      })
    ).statusCode,
  ).toBe(410);
});
it("F06: simultaneous revocation versus contribution has one authorization order; a later action is denied and accepted history remains", async () => {
  // Restore the existing isolated test member; this is fixture setup, not an
  // application unban shortcut. Production unban still requires reapproval.
  await pool.query(
    "UPDATE wf2_memberships SET state='active',revision=revision+1 WHERE id=$1",
    [memberId],
  );
  await pool.query(
    "UPDATE wf2_world_grants SET can_view=true,can_contribute=true,revoked_at=NULL WHERE world_id=$1 AND person_id=(SELECT person_id FROM wf2_memberships WHERE id=$2)",
    [world, memberId],
  );
  let draft;
  const failures: unknown[] = [];
  for (const [x, y] of [
    [7, -7],
    [7, 0],
    [7, 7],
    [12, 0],
    [-12, -8],
    [0, -12],
  ]) {
    const r = await send(
      command("CreateDraft", { site: { qx: x! * 256, qy: y! * 256 } }),
    );
    if (r.statusCode === 200) {
      draft = r.json().result;
      break;
    }
    failures.push({ status: r.statusCode, code: r.json().error?.code });
  }
  expect(draft, JSON.stringify(failures)).toBeTruthy();
  const p = draft!;
  expect(
    (
      await send(
        command("PublishProject", {
          projectId: p.projectId,
          expectedProjectRevision: "1",
          planHash: p.planHash,
        }),
      )
    ).statusCode,
  ).toBe(200);
  const revision = (
    await pool.query("SELECT revision FROM wf2_memberships WHERE id=$1", [
      memberId,
    ])
  ).rows[0].revision;
  const [contribution, ban] = await Promise.all([
    send(
      command("Contribute", {
        projectId: p.projectId,
        planHash: p.planHash,
        recognitionOptIn: false,
      }),
      memberHeaders,
    ),
    send(
      command("BanMember", { memberId, expectedMembershipRevision: revision }),
    ),
  ]);
  expect(ban.statusCode).toBe(200);
  expect([200, 404]).toContain(contribution.statusCode);
  const count = (
    await pool.query(
      "SELECT count(*)::int n FROM wf2_contributions WHERE project_id=$1",
      [p.projectId],
    )
  ).rows[0].n;
  expect(count).toBe(contribution.statusCode === 200 ? 1 : 0);
  expect(
    (
      await send(
        command("Contribute", {
          projectId: p.projectId,
          planHash: p.planHash,
          recognitionOptIn: false,
        }),
        memberHeaders,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await pool.query("SELECT accepted_count FROM wf2_projects WHERE id=$1", [
        p.projectId,
      ])
    ).rows[0].accepted_count,
  ).toBe(count);
  const current = (
    await pool.query("SELECT revision FROM wf2_projects WHERE id=$1", [
      p.projectId,
    ])
  ).rows[0];
  expect(
    (
      await send(
        command("CancelProject", {
          projectId: p.projectId,
          expectedProjectRevision: current.revision,
        }),
      )
    ).statusCode,
  ).toBe(200);
  await pool.query(
    "UPDATE wf2_memberships SET state='active',revision=revision+1 WHERE id=$1",
    [memberId],
  );
  await pool.query(
    "UPDATE wf2_world_grants SET can_view=true,can_contribute=true,revoked_at=NULL WHERE world_id=$1 AND person_id=(SELECT person_id FROM wf2_memberships WHERE id=$2)",
    [world, memberId],
  );
  expect(await signature()).toBe(original);
});

it("D02–D10: negative/seam sites, deterministic drafts, publish race, frozen plans and cancelled-draft privacy", async () => {
  for (const site of [
    { qx: 12800, qy: 0 },
    { qx: 6656, qy: -2048 },
    { qx: 4096, qy: 0 },
  ])
    expect((await send(command("CreateDraft", { site }))).statusCode).toBe(400);
  const a = await send(command("CreateDraft", { site: { qx: -1792, qy: 0 } })),
    b = await send(command("CreateDraft", { site: { qx: -1792, qy: 0 } }));
  expect(a.statusCode, a.body).toBe(200);
  expect(b.statusCode).toBe(200);
  expect(a.json().result.planHash).toBe(b.json().result.planHash);
  const plans = [a.json().result, b.json().result];
  const beforeCount = (
    await pool.query(
      "SELECT count(*)::int n FROM founding_structures WHERE world_id=$1",
      [world],
    )
  ).rows[0].n;
  const results = await Promise.all(
    plans.map((p) =>
      send(
        command("PublishProject", {
          projectId: p.projectId,
          expectedProjectRevision: "1",
          planHash: p.planHash,
        }),
      ),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe(
    "ACTIVE_PROJECT_LIMIT",
  );
  const claims = (
    await pool.query(
      "SELECT hx,hy,kind FROM wf2_claims WHERE world_id=$1 AND kind='reserved'",
      [world],
    )
  ).rows;
  expect(claims).toHaveLength(144);
  expect(claims.every((c) => c.hx < 0)).toBe(true);
  expect(claims.some((c) => c.hy < 0) && claims.some((c) => c.hy >= 0)).toBe(
    true,
  );
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM founding_structures WHERE world_id=$1",
        [world],
      )
    ).rows[0].n,
  ).toBe(beforeCount);
  for (const p of plans) {
    const row = (
      await pool.query(
        "SELECT revision,published_at FROM wf2_projects WHERE id=$1",
        [p.projectId],
      )
    ).rows[0];
    if (row.published_at) {
      await expect(
        pool.query("UPDATE wf2_projects SET goal=goal+1 WHERE id=$1", [
          p.projectId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    }
    expect(
      (
        await send(
          command("CancelProject", {
            projectId: p.projectId,
            expectedProjectRevision: row.revision,
          }),
        )
      ).statusCode,
    ).toBe(200);
    if (!row.published_at) {
      expect(
        (
          await app.inject({
            url: `/api/wf2/worlds/${world}/projects/${p.projectId}`,
            headers: memberHeaders,
          })
        ).statusCode,
      ).toBe(404);
      const current = await app.inject({
        url: `/api/wf2/worlds/${world}/bootstrap`,
        headers: memberHeaders,
      });
      expect(current.statusCode).toBe(200);
      expect(
        current.json().projects.some((v: any) => v.id === p.projectId),
      ).toBe(false);
    }
  }
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_claims WHERE world_id=$1 AND kind='reserved'",
        [world],
      )
    ).rows[0].n,
  ).toBe(0);
  await expect(
    pool.query("UPDATE wf2_rulesets SET goal=1"),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("DELETE FROM wf2_contributions WHERE project_id=$1", [
      projectId,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  expect(await signature()).toBe(original);
});
it("E02/E03/E06/C05/C06: contiguous durable replay, safe fields and bounded prefix pruning with current snapshot recovery", async () => {
  const a = {
    person_id: owner,
    session_hash: hash(headers.cookie!.split("=")[1]!),
  };
  const r = await replay(pool, a, world, "1", 200);
  expect(r.batches.length).toBeGreaterThan(3);
  let n = 1n;
  for (const b of r.batches) {
    expect(b.fromCursor).toBe(n.toString());
    n++;
    expect(b.toCursor).toBe(n.toString());
  }
  const safe = JSON.stringify(r);
  for (const forbidden of [
    "person_id",
    "twitch_subject",
    "display_name",
    "encrypted_tokens",
    "Fixture",
    "Test person",
  ])
    expect(safe).not.toContain(forbidden);
  expect(
    (
      await app.inject({
        url: `/api/wf2/worlds/${world}/events?after=1`,
        headers,
      })
    ).statusCode,
  ).toBe(200);
  await pool.query(
    "UPDATE wf2_shared_batches SET committed_at=now()-interval '8 days'",
  );
  await pool.query(
    "INSERT INTO wf2_operational_logs(at,code) VALUES(now()-interval '15 days','OLD'),(now(),'CURRENT')",
  );
  await pruneReplay(pool);
  await expect(replay(pool, a, world, "1")).rejects.toMatchObject({
    code: "RESET_REQUIRED",
  });
  const snapshot = await bootstrap(pool, a, world);
  expect(snapshot.structures).toHaveLength(2);
  expect(snapshot.projects[0].acceptedCount).toBe(2);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_contributions WHERE project_id=$1",
        [projectId],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(
    (
      await pool.query(
        "SELECT code FROM wf2_operational_logs WHERE code IN('OLD','CURRENT') ORDER BY code",
      )
    ).rows.map((r) => r.code),
  ).toEqual(["CURRENT"]);
  expect(
    (await pool.query("SELECT count(*)::int n FROM wf2_outbox")).rows[0].n,
  ).toBe(0);
  // Synthetic invalidations, not community achievements: independently exercise the count cap.
  const head = (
    await pool.query(
      "SELECT w.public_cursor,w.topology_epoch,b.credit_revision FROM founding_worlds w JOIN wf2_bindings b ON b.world_id=w.id WHERE w.id=$1",
      [world],
    )
  ).rows[0];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "WITH generated AS MATERIALIZED(SELECT n,gen_random_uuid() AS id FROM generate_series(1,10002) n) INSERT INTO wf2_shared_batches(world_id,cursor,batch_id,batch_schema,payload) SELECT $1::uuid,$2::bigint+n,id,'wf2-batch-1',jsonb_build_object('batchSchema','wf2-batch-1','worldId',($1::uuid)::text,'batchId',id,'fromCursor',($2::bigint+n-1)::text,'toCursor',($2::bigint+n)::text,'kind','RecognitionChanged','changes',jsonb_build_array(jsonb_build_object('type','creditInvalidation','projectId',$3::text)),'topologyEpoch',$4::text,'creditRevision',$5::text,'changedChunks','[]'::jsonb) FROM generated",
      [
        world,
        head.public_cursor,
        projectId,
        head.topology_epoch,
        head.credit_revision,
      ],
    );
    await db.query(
      "INSERT INTO wf2_outbox(world_id,cursor,state,next_attempt_at,attempt) SELECT world_id,cursor,'pending',now(),0 FROM wf2_shared_batches WHERE world_id=$1",
      [world],
    );
    await db.query(
      "UPDATE founding_worlds SET public_cursor=public_cursor+10002 WHERE id=$1",
      [world],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  await pruneReplay(pool);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_shared_batches WHERE world_id=$1",
        [world],
      )
    ).rows[0].n,
  ).toBe(10000);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_outbox WHERE world_id=$1",
        [world],
      )
    ).rows[0].n,
  ).toBe(10000);
  await expect(
    replay(pool, a, world, head.public_cursor),
  ).rejects.toMatchObject({ code: "RESET_REQUIRED" });
  expect((await bootstrap(pool, a, world)).structures).toHaveLength(2);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_contributions WHERE project_id=$1",
        [projectId],
      )
    ).rows[0].n,
  ).toBe(2);
  await expect(
    replay(pool, a, world, (BigInt(head.public_cursor) + 20000n).toString()),
  ).rejects.toMatchObject({ code: "RESET_REQUIRED" });
  const originalHeader = (
    await pool.query("SELECT header FROM founding_worlds WHERE id=$1", [world])
  ).rows[0].header;
  try {
    await pool.query(
      "UPDATE founding_worlds SET header=jsonb_set(header,'{baseline,hash}',to_jsonb($2::text)) WHERE id=$1",
      [world, "0".repeat(64)],
    );
    await expect(bootstrap(pool, a, world)).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
    });
  } finally {
    await pool.query("UPDATE founding_worlds SET header=$2 WHERE id=$1", [
      world,
      originalHeader,
    ]);
  }
});
it("B08/B09: approval and ban serialize; pending applicants can leave; banned applicants cannot consume a fresh link", async () => {
  const cursorBefore = (
    await pool.query("SELECT public_cursor FROM founding_worlds WHERE id=$1", [
      world,
    ])
  ).rows[0].public_cursor;
  const person = randomUUID(),
    h = await identity(person),
    i = await invite(),
    c = await continuation(i.token);
  const joined = await app.inject({
    method: "POST",
    url: "/api/wf2/join/commands",
    headers: { ...h, cookie: h.cookie + "; " + c.cookie },
    payload: command("RequestJoin", { continuationId: c.id }),
  });
  expect(joined.statusCode).toBe(200);
  const m = (
    await pool.query("SELECT id FROM wf2_memberships WHERE person_id=$1", [
      person,
    ])
  ).rows[0].id;
  const raced = await Promise.all([
    send(
      command("ApproveRequest", {
        requestId: joined.json().result.requestId,
        expectedRequestRevision: "1",
      }),
    ),
    send(
      command("BanMember", { memberId: m, expectedMembershipRevision: "1" }),
    ),
  ]);
  expect(raced.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  let member = (
    await pool.query("SELECT state,revision FROM wf2_memberships WHERE id=$1", [
      m,
    ])
  ).rows[0];
  if (member.state === "active") {
    expect(
      (
        await send(
          command("BanMember", {
            memberId: m,
            expectedMembershipRevision: member.revision,
          }),
        )
      ).statusCode,
    ).toBe(200);
    member = (
      await pool.query(
        "SELECT state,revision FROM wf2_memberships WHERE id=$1",
        [m],
      )
    ).rows[0];
  }
  expect(member.state).toBe("banned");
  const fresh = await invite(),
    resume = await continuation(fresh.token);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/wf2/join/commands",
        headers: { ...h, cookie: h.cookie + "; " + resume.cookie },
        payload: command("RequestJoin", { continuationId: resume.id }),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await pool.query(
        "SELECT consumed_request_id FROM wf2_invitations WHERE id=$1",
        [fresh.id],
      )
    ).rows[0].consumed_request_id,
  ).toBeNull();
  expect(
    (
      await send(
        command("UnbanMember", {
          memberId: m,
          expectedMembershipRevision: member.revision,
        }),
      )
    ).statusCode,
  ).toBe(200);
  const req = await app.inject({
    method: "POST",
    url: "/api/wf2/join/commands",
    headers: { ...h, cookie: h.cookie + "; " + resume.cookie },
    payload: command("RequestJoin", { continuationId: resume.id }),
  });
  expect(req.statusCode).toBe(200);
  const own = (await app.inject({ url: "/api/wf2/me", headers: h })).json();
  expect(own.grants).toHaveLength(0);
  expect(
    own.requests.some(
      (r: any) =>
        r.requestId === req.json().result.requestId && r.worldId === world,
    ),
  ).toBe(true);
  expect((await send(command("LeaveCommunity"), h)).statusCode).toBe(200);
  const status = (
    await app.inject({
      url: "/api/wf2/join/requests/" + req.json().result.requestId,
      headers: h,
    })
  ).json();
  expect(status.state).toBe("withdrawn");
  expect(status.eligibility).toBe("left");
  expect(
    (
      await pool.query(
        "SELECT public_cursor FROM founding_worlds WHERE id=$1",
        [world],
      )
    ).rows[0].public_cursor,
  ).toBe(cursorBefore);
});
it("B07/B08: two creator approvals race for eighth non-creator slot; pending requests do not count", async () => {
  const community = (
    await pool.query(
      "SELECT community_id FROM wf2_bindings WHERE world_id=$1",
      [world],
    )
  ).rows[0].community_id;
  for (let n = 0; n < 6; n++) {
    const person = randomUUID();
    await identity(person);
    await pool.query(
      "INSERT INTO wf2_memberships(id,community_id,person_id,state) VALUES($1,$2,$3,'active')",
      [randomUUID(), community, person],
    );
    await pool.query(
      "INSERT INTO wf2_world_grants(world_id,community_id,person_id,can_view,can_contribute) VALUES($1,$2,$3,true,true)",
      [world, community, person],
    );
  }
  const requests = [];
  for (let n = 0; n < 2; n++) {
    const h = await identity(randomUUID()),
      i = await invite(),
      c = await continuation(i.token);
    const r = await app.inject({
      method: "POST",
      url: "/api/wf2/join/commands",
      headers: { ...h, cookie: h.cookie + "; " + c.cookie },
      payload: command("RequestJoin", { continuationId: c.id }),
    });
    expect(r.statusCode).toBe(200);
    requests.push(r.json().result.requestId);
  }
  const r = await Promise.all(
    requests.map((requestId) =>
      send(
        command("ApproveRequest", { requestId, expectedRequestRevision: "1" }),
      ),
    ),
  );
  expect(r.map((v) => v.statusCode).sort()).toEqual([200, 409]);
  expect(r.find((v) => v.statusCode === 409)!.json().error.code).toBe(
    "COHORT_LIMIT",
  );
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM wf2_memberships WHERE community_id=$1 AND state='active' AND person_id<>$2",
        [community, owner],
      )
    ).rows[0].n,
  ).toBe(8);
});
it("E04/E08/E10/E11: two actual HTTP servers deliver after notified outbox, enforce stream caps and revoke from DB", async () => {
  const second = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      throw Error("unused");
    },
  });
  const address1 = await app.listen({ host: "127.0.0.1", port: 0 }),
    address2 = await second.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController(),
    connections: Response[] = [];
  const head = (
    await pool.query("SELECT public_cursor FROM founding_worlds WHERE id=$1", [
      world,
    ])
  ).rows[0].public_cursor;
  const open = (address: string, h: Record<string, string>) =>
    fetch(`${address}/api/wf2/worlds/${world}/stream?after=${head}`, {
      headers: { cookie: h.cookie!, origin: config.webOrigin },
      signal: controller.signal,
    });
  const until = async (r: Response, event: string) => {
    const reader = r.body!.getReader();
    let text = "";
    const limit = AbortSignal.timeout(2500);
    try {
      while (!text.includes("event: " + event)) {
        const value = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            limit.addEventListener(
              "abort",
              () => reject(Error("SSE timeout")),
              { once: true },
            ),
          ),
        ]);
        if (value.done) break;
        text += new TextDecoder().decode(value.value);
      }
      return text;
    } finally {
      reader.releaseLock();
    }
  };
  try {
    const [one, two] = await Promise.all([
      open(address1, headers),
      open(address2, memberHeaders),
    ]);
    connections.push(one, two);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(one.headers.get("content-type")).toBe("text/event-stream");
    const waiting1 = until(one, "batch"),
      waiting2 = until(two, "batch");
    expect(
      (await send(command("SetRecognition", { projectId, optedIn: true })))
        .statusCode,
    ).toBe(200);
    await pool.query("UPDATE wf2_outbox SET state='notified'");
    const delivered = await Promise.all([waiting1, waiting2]);
    for (const t of delivered) {
      expect(t).toContain("RecognitionChanged");
      expect(t).not.toContain("Test person");
      expect(t).not.toContain("person_id");
    }
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => open(address1, headers)),
    );
    connections.push(...attempts);
    expect(attempts.filter((r) => r.status === 200)).toHaveLength(3);
    expect(attempts.filter((r) => r.status === 429)).toHaveLength(2);
    const bad = await fetch(
      `${address1}/api/wf2/worlds/${world}/events?after=${head}`,
      {
        headers: {
          cookie: headers.cookie!,
          origin: "https://untrusted.example",
        },
      },
    );
    expect(bad.status).toBe(403);
    const waitRevoke = until(two, "reauth"),
      at = performance.now();
    await pool.query(
      "UPDATE wf2_world_grants SET can_view=false,can_contribute=false,revoked_at=now(),revision=revision+1 WHERE world_id=$1 AND person_id=(SELECT person_id FROM wf2_memberships WHERE id=$2)",
      [world, memberId],
    );
    expect(await waitRevoke).toContain("event: reauth");
    expect(performance.now() - at).toBeLessThan(1000);
  } finally {
    controller.abort();
    await Promise.allSettled(connections.map((r) => r.body?.cancel()));
    await second.close();
    await pool.query(
      "UPDATE wf2_world_grants SET can_view=true,can_contribute=true,revoked_at=NULL WHERE world_id=$1 AND person_id=(SELECT person_id FROM wf2_memberships WHERE id=$2)",
      [world, memberId],
    );
  }
}, 15000);
it("E11: an actual paused HTTP consumer is disconnected with bounded server buffers and durable replay intact", async () => {
  const slow = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      throw Error("unused");
    },
  });
  const address = await slow.listen({ host: "127.0.0.1", port: 0 }),
    controller = new AbortController();
  const head = (
    await pool.query(
      "SELECT w.public_cursor,w.topology_epoch,b.credit_revision FROM founding_worlds w JOIN wf2_bindings b ON b.world_id=w.id WHERE w.id=$1",
      [world],
    )
  ).rows[0];
  const start = BigInt(head.public_cursor),
    batches = Array.from({ length: 300 }, (_, i) => ({
      batchSchema: "wf2-batch-1",
      worldId: world,
      batchId: randomUUID(),
      fromCursor: (start + BigInt(i)).toString(),
      toCursor: (start + BigInt(i) + 1n).toString(),
      kind: "RecognitionChanged",
      changes: Array.from({ length: 200 }, () => ({
        type: "creditInvalidation",
        projectId,
      })),
      topologyEpoch: head.topology_epoch,
      creditRevision: head.credit_revision,
      changedChunks: [],
    }));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO wf2_shared_batches(world_id,cursor,batch_id,batch_schema,payload) SELECT $1,(p->>'toCursor')::bigint,(p->>'batchId')::uuid,'wf2-batch-1',p FROM jsonb_array_elements($2::jsonb) p",
      [world, JSON.stringify(batches)],
    );
    await db.query("UPDATE founding_worlds SET public_cursor=$2 WHERE id=$1", [
      world,
      (start + 300n).toString(),
    ]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  let response: Response | undefined;
  try {
    response = await fetch(
      `${address}/api/wf2/worlds/${world}/stream?after=${start}`,
      {
        headers: { cookie: headers.cookie!, origin: config.webOrigin },
        signal: controller.signal,
      },
    );
    expect(response.status).toBe(200);
    // Deliberately never pull response.body; payloads are synthetic safe invalidations.
    for (let i = 0; i < 100; i++) {
      if ((streamDiagnostics(slow)?.slowDisconnects ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const stats = streamDiagnostics(slow)!;
    expect(stats.slowDisconnects).toBeGreaterThan(0);
    expect(stats.maxBufferedBytes).toBeLessThanOrEqual(262144);
    expect(stats.activeStreams).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM wf2_contributions WHERE project_id=$1",
          [projectId],
        )
      ).rows[0].n,
    ).toBe(2);
    const actor = {
      person_id: owner,
      session_hash: hash(headers.cookie!.split("=")[1]!),
    };
    expect(
      (await replay(pool, actor, world, start.toString())).batches.length,
    ).toBe(100);
  } finally {
    controller.abort();
    await response?.body?.cancel().catch(() => {});
    await slow.close();
  }
}, 15000);
it("F07/F09–F11: contribution avoids topology lock; partial construction rolls back; stale lease/cancel race has one terminal result", async () => {
  const draft = await send(
    command("CreateDraft", { site: { qx: -1792, qy: 1280 } }),
  );
  expect(draft.statusCode, draft.body).toBe(200);
  const p = draft.json().result;
  expect(
    (
      await send(
        command("PublishProject", {
          projectId: p.projectId,
          expectedProjectRevision: "1",
          planHash: p.planHash,
        }),
      )
    ).statusCode,
  ).toBe(200);
  const held = await pool.connect();
  await held.query("BEGIN");
  await held.query(
    "SELECT world_id FROM wf2_topology_guards WHERE world_id=$1 FOR UPDATE",
    [world],
  );
  const start = performance.now();
  try {
    const r = await send(
      command("Contribute", {
        projectId: p.projectId,
        planHash: p.planHash,
        recognitionOptIn: false,
      }),
    );
    expect(r.statusCode).toBe(200);
    expect(performance.now() - start).toBeLessThan(1000);
  } finally {
    await held.query("ROLLBACK");
    held.release();
  }
  await app.close();
  const member = (
    await pool.query("SELECT person_id FROM wf2_memberships WHERE id=$1", [
      memberId,
    ])
  ).rows[0].person_id;
  const actor = {
    person_id: member,
    session_hash: hash(memberHeaders.cookie!.split("=")[1]!),
  };
  const child = (mode: string, extra: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) =>
      execFile(
        process.execPath,
        ["--import", "tsx", "scripts/wf2-crash-child.mjs"],
        {
          env: {
            ...process.env,
            WF2_CRASH_TEST: "isolated-wf2-only",
            WF2_CRASH_MODE: mode,
            ...extra,
          },
          timeout: 12000,
        },
        (error) => {
          if (error && typeof error.code !== "number")
            reject(Error("Crash child failed to execute"));
          else resolve(error?.code ?? 0);
        },
      ),
    );
  expect(
    await child("contribute", {
      WF2_CRASH_PERSON: member,
      WF2_CRASH_PROJECT: p.projectId,
      WF2_CRASH_COMMAND: randomUUID(),
    }),
  ).toBe(43);
  expect(
    (
      await pool.query("SELECT state FROM wf2_projects WHERE id=$1", [
        p.projectId,
      ])
    ).rows[0].state,
  ).toBe("ready");
  const cursorBefore = (
    await pool.query("SELECT public_cursor FROM founding_worlds WHERE id=$1", [
      world,
    ])
  ).rows[0].public_cursor;
  expect(await child("mid-transaction")).toBe(42);
  expect(
    (
      await pool.query(
        "SELECT public_cursor FROM founding_worlds WHERE id=$1",
        [world],
      )
    ).rows[0].public_cursor,
  ).toBe(cursorBefore);
  await pool.query(
    "UPDATE wf2_completion_jobs SET lease_until=now()-interval '1 second' WHERE project_id=$1",
    [p.projectId],
  );
  const job = await leaseCompletion(pool);
  expect(job).toBeTruthy();
  await expect(
    completeConstruction(pool, job, () => {
      throw Error("Injected crash after structure");
    }),
  ).rejects.toThrow("Injected crash");
  expect(
    (await pool.query("SELECT count(*)::int n FROM wf2_completion_results"))
      .rows[0].n,
  ).toBe(1);
  expect(
    (await pool.query("SELECT count(*)::int n FROM founding_structures"))
      .rows[0].n,
  ).toBe(2);
  await pool.query(
    "UPDATE wf2_completion_jobs SET lease_until=now()-interval '1 second' WHERE project_id=$1",
    [p.projectId],
  );
  const reclaimed = await leaseCompletion(pool);
  expect(reclaimed.lease_token).not.toBe(job.lease_token);
  expect(await completeConstruction(pool, job)).toBe(false);
  const ownerActor = {
    person_id: owner,
    session_hash: hash(headers.cookie!.split("=")[1]!),
  };
  const project = (
    await pool.query("SELECT revision FROM wf2_projects WHERE id=$1", [
      p.projectId,
    ])
  ).rows[0];
  const race = await Promise.allSettled([
    completeConstruction(pool, reclaimed),
    projectCommand(
      pool,
      ownerActor,
      world,
      command("CancelProject", {
        projectId: p.projectId,
        expectedProjectRevision: project.revision,
      }) as any,
    ),
    bootstrap(pool, ownerActor, world),
  ]);
  const snap = race[2];
  expect(snap?.status).toBe("fulfilled");
  if (snap?.status === "fulfilled") {
    const value = snap.value as Awaited<ReturnType<typeof bootstrap>>;
    expect(value.structures.length).toBe(value.paths.length);
    for (const p of value.projects)
      if (p.state === "completed") {
        expect(
          value.structures.some((s) => s.id === "wf2-workshop-" + p.id),
        ).toBe(true);
        expect(value.paths.some((r) => r.id === "wf2-path-" + p.id)).toBe(true);
      }
  }
  const end = (
    await pool.query("SELECT state FROM wf2_projects WHERE id=$1", [
      p.projectId,
    ])
  ).rows[0].state;
  expect(["completed", "cancelled"]).toContain(end);
  const results = (
    await pool.query(
      "SELECT count(*)::int n FROM wf2_completion_results WHERE project_id=$1",
      [p.projectId],
    )
  ).rows[0].n;
  expect(results).toBe(end === "completed" ? 1 : 0);
  expect(race.some((r) => r.status === "fulfilled")).toBe(true);
  expect(await signature()).toBe(original);
});
it("F12/D10: transient failures exhaust into a visible blocked project; same-plan retry completes once", async () => {
  const faultApp = await buildApp(config, pool, {
    exchange: async () => {
      throw Error("unused");
    },
    refresh: async () => {
      throw Error("unused");
    },
    validate: async () => {
      throw Error("unused");
    },
  });
  const post = (b: object, h = headers) =>
    faultApp.inject({
      method: "POST",
      url: `/api/wf2/worlds/${world}/commands`,
      headers: h,
      payload: b,
    });
  let trigger = false;
  try {
    await pool.query(
      "CREATE OR REPLACE FUNCTION wf2_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected serialization failure' USING ERRCODE='40001'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER wf2_test_fault BEFORE INSERT ON founding_structures FOR EACH ROW WHEN(NEW.template='wf2-workshop-1') EXECUTE FUNCTION wf2_test_fault()",
    );
    trigger = true;
    const draft = await post(
      command("CreateDraft", { site: { qx: 1792, qy: -1792 } }),
    );
    expect(draft.statusCode, draft.body).toBe(200);
    const p = draft.json().result;
    expect(
      (
        await post(
          command("PublishProject", {
            projectId: p.projectId,
            expectedProjectRevision: "1",
            planHash: p.planHash,
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          command("Contribute", {
            projectId: p.projectId,
            planHash: p.planHash,
            recognitionOptIn: false,
          }),
          memberHeaders,
        )
      ).statusCode,
    ).toBe(200);
    const memberRevision = (
      await pool.query("SELECT revision FROM wf2_memberships WHERE id=$1", [
        memberId,
      ])
    ).rows[0].revision;
    expect(
      (
        await post(
          command("BanMember", {
            memberId,
            expectedMembershipRevision: memberRevision,
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          command("Contribute", {
            projectId: p.projectId,
            planHash: p.planHash,
            recognitionOptIn: false,
          }),
          headers,
        )
      ).statusCode,
    ).toBe(200);
    let state;
    for (let n = 0; n < 220; n++) {
      state = (
        await pool.query("SELECT * FROM wf2_projects WHERE id=$1", [
          p.projectId,
        ])
      ).rows[0];
      if (state.state === "blocked") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(state.state).toBe("blocked");
    expect(state.blocked_code).toBe("RETRY_EXHAUSTED");
    expect(state.accepted_count).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT attempt FROM wf2_completion_jobs WHERE project_id=$1",
          [p.projectId],
        )
      ).rows[0].attempt,
    ).toBe(4);
    // A permanent dependency failure blocks immediately, retains the frozen plan
    // and can only retry that same plan. It is distinct from retry exhaustion.
    await pool.query(
      "CREATE OR REPLACE FUNCTION wf2_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'permanent test dependency failure' USING ERRCODE='23514'; END $$",
    );
    const permanentRetry = await post(
      command("RetryCompletion", {
        projectId: p.projectId,
        expectedProjectRevision: state.revision,
        planHash: p.planHash,
      }),
    );
    expect(permanentRetry.statusCode).toBe(200);
    for (let n = 0; n < 100; n++) {
      state = (
        await pool.query("SELECT * FROM wf2_projects WHERE id=$1", [
          p.projectId,
        ])
      ).rows[0];
      if (state.state === "blocked") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(state.state).toBe("blocked");
    expect(state.blocked_code).toBe("PLAN_OR_ASSET_INVALID");
    expect(state.plan_hash).toBe(p.planHash);
    expect(state.accepted_count).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT attempt FROM wf2_completion_jobs WHERE project_id=$1",
          [p.projectId],
        )
      ).rows[0].attempt,
    ).toBe(1);
    await pool.query("DROP TRIGGER wf2_test_fault ON founding_structures");
    trigger = false;
    const retry = await post(
      command("RetryCompletion", {
        projectId: p.projectId,
        expectedProjectRevision: state.revision,
        planHash: p.planHash,
      }),
    );
    expect(retry.statusCode).toBe(200);
    for (let n = 0; n < 100; n++) {
      if (
        (
          await pool.query("SELECT state FROM wf2_projects WHERE id=$1", [
            p.projectId,
          ])
        ).rows[0].state === "completed"
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(
      (
        await pool.query(
          "SELECT state,plan_hash,accepted_count FROM wf2_projects WHERE id=$1",
          [p.projectId],
        )
      ).rows[0],
    ).toEqual({ state: "completed", plan_hash: p.planHash, accepted_count: 2 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM wf2_completion_results WHERE project_id=$1",
          [p.projectId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await signature()).toBe(original);
  } finally {
    if (trigger)
      await pool.query("DROP TRIGGER wf2_test_fault ON founding_structures");
    await pool.query("DROP FUNCTION IF EXISTS wf2_test_fault()");
    await faultApp.close();
  }
}, 20000);
