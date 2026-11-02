// Synthetic, loopback-only fixture. Construction/admission use the actual application HTTP handlers.
import { randomUUID } from "node:crypto";
import { generateBaseline } from "../packages/world/dist/founding.js";
import { generateWorld } from "../packages/world/dist/index.js";
import { publishFounding } from "../apps/server/dist/founding.js";
import { hash, encrypt, randomToken } from "../apps/server/dist/security.js";
export const DEMO_WORLD = "f1000000-0000-4000-8000-000000000001";
export const DEMO_DB = "creators_village_f1_demo";
export const DEMO_KEY = "f".repeat(64);
export function demoConfig(databaseUrl, origin) {
  return {
    databaseUrl,
    clientId: "f1-synthetic",
    clientSecret: "not-real",
    redirectUri: origin + "/auth/twitch/callback",
    webOrigin: origin,
    encryptionKey: DEMO_KEY,
    secureCookies: false,
    production: true,
    wf2WorldId: DEMO_WORLD,
  };
}
export function demoProvider(fixture) {
  return {
    exchange: async () => {
      throw Error("No real Twitch provider in F1 demonstration");
    },
    refresh: async (role) => {
      if (!fixture.actors[role]) throw Error("Unknown synthetic identity");
      return { access_token: role, refresh_token: role, expires_in: 7200 };
    },
    validate: async (role) => {
      const a = fixture.actors[role];
      if (!a) throw Error("Unknown synthetic identity");
      return {
        subject: "f1-demo-" + role,
        displayName: a.name,
        login: "f1_demo_" + role,
      };
    },
  };
}
export async function seedDemoBase(pool) {
  const fixture = {
    version: "cv-f1-demo-1",
    world: DEMO_WORLD,
    seed: "fern",
    label: "Synthetic demonstration — no Twitch activity",
    actors: {},
    projects: {},
  };
  for (const [i, role, name] of [
    [2, "owner", "Demo Creator"],
    [3, "member", "Demo Builder"],
    [4, "outsider", "Demo Observer"],
  ]) {
    const id = `f1000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      raw = randomToken(),
      csrf = randomToken();
    await pool.query(
      "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4)",
      [id, "f1-demo-" + role, name, "f1_demo_" + role],
    );
    await pool.query(
      "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '7 days')",
      [
        hash(raw),
        id,
        csrf,
        encrypt(
          { access_token: role, refresh_token: role, expires_in: 7200 },
          DEMO_KEY,
        ),
      ],
    );
    fixture.actors[role] = { id, name, raw, csrf, sessionHash: hash(raw) };
  }
  const owner = fixture.actors.owner.id,
    legacy = generateWorld("fern", {
      id: "f1000000-0000-4000-8000-000000000005",
      name: "Demo — Fernbrook original village",
      createdAt: "2026-11-02T00:00:00Z",
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
    lease = new Date(Date.now() + 30000).toISOString(),
    baseline = generateBaseline("fern");
  await pool.query(
    "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,'Demo — Fernbrook Workshop Village','fern','development','working',$6)",
    [job, owner, randomUUID(), hash("f1-demo-fixture"), DEMO_WORLD, lease],
  );
  await publishFounding(pool, job, baseline, lease);
  fixture.baselineHash = baseline.hash;
  return fixture;
}
export const demoHeaders = (fixture, role, origin) => ({
  cookie: "cv_session=" + fixture.actors[role].raw,
  origin,
  "x-csrf-token": fixture.actors[role].csrf,
});
export async function demoCommand(
  app,
  fixture,
  role,
  kind,
  payload = {},
  commandId = randomUUID(),
  origin = "http://127.0.0.4:3009",
) {
  const r = await app.inject({
    method: "POST",
    url: `/api/wf2/worlds/${DEMO_WORLD}/commands`,
    headers: demoHeaders(fixture, role, origin),
    payload: { commandSchema: "wf2-command-1", commandId, kind, payload },
  });
  if (r.statusCode !== 200)
    throw Error(`${kind} failed ${r.statusCode}: ${r.body}`);
  return r.json();
}
export async function initialiseDemo(app, pool, f) {
  await demoCommand(app, f, "owner", "EnablePlaytest", {
    expectedBaselineHash: f.baselineHash,
  });
  const invitation = await demoCommand(app, f, "owner", "IssueInvitation");
  const link = await app.inject({
    url: `/api/wf2/worlds/${DEMO_WORLD}/invitations/${invitation.result.inviteId}/link`,
    headers: demoHeaders(f, "owner", "http://127.0.0.4:3009"),
  });
  const token = new URL("http://demo.invalid" + link.json().url).hash.slice(
    "#request=".length,
  );
  const c = await app.inject({
    method: "POST",
    url: "/api/wf2/join/continuations",
    headers: { origin: "http://127.0.0.4:3009", "x-wf2-join": "1" },
    payload: { token },
  });
  if (c.statusCode !== 200) throw Error("Demo continuation failed: " + c.body);
  const continuationCookie = [c.headers["set-cookie"]].flat()[0].split(";")[0];
  const request = await app.inject({
    method: "POST",
    url: "/api/wf2/join/commands",
    headers: {
      ...demoHeaders(f, "member", "http://127.0.0.4:3009"),
      cookie: demoHeaders(f, "member", "").cookie + "; " + continuationCookie,
    },
    payload: {
      commandSchema: "wf2-command-1",
      commandId: randomUUID(),
      kind: "RequestJoin",
      payload: { continuationId: c.json().continuationId },
    },
  });
  if (request.statusCode !== 200)
    throw Error("Demo request failed: " + request.body);
  await demoCommand(app, f, "owner", "ApproveRequest", {
    requestId: request.json().result.requestId,
    expectedRequestRevision: "1",
  });
  async function project(qx, qy) {
    const d = await demoCommand(app, f, "owner", "CreateDraft", {
      site: { qx, qy },
    });
    await demoCommand(app, f, "owner", "PublishProject", {
      projectId: d.result.projectId,
      expectedProjectRevision: "1",
      planHash: d.result.planHash,
    });
    return d.result;
  }
  const complete = await project(-1792, 1280);
  await demoCommand(app, f, "owner", "Contribute", {
    projectId: complete.projectId,
    planHash: complete.planHash,
    recognitionOptIn: false,
  });
  await demoCommand(app, f, "member", "Contribute", {
    projectId: complete.projectId,
    planHash: complete.planHash,
    recognitionOptIn: false,
  });
  for (let i = 0; i < 100; i++) {
    const row = (
      await pool.query("SELECT state FROM wf2_projects WHERE id=$1", [
        complete.projectId,
      ])
    ).rows[0];
    if (row.state === "completed") break;
    if (i === 99)
      throw Error("Real completion worker did not finish demo workshop");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const active = await project(1792, 1280);
  await demoCommand(app, f, "owner", "Contribute", {
    projectId: active.projectId,
    planHash: active.planHash,
    recognitionOptIn: false,
  });
  f.projects = { completed: complete.projectId, active: active.projectId };
  return f;
}
