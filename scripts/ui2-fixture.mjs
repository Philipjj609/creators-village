// Synthetic fixture utilities. Excluded from the production runtime allowlist.
import { randomUUID } from "node:crypto";
import { generateBaseline } from "../packages/world/dist/founding.js";
import { generateWorld } from "../packages/world/dist/index.js";
import { publishFounding } from "../apps/server/dist/founding.js";
import { activate } from "../apps/server/dist/participation-core.js";
import {
  admissionCommand,
  invitationLink,
  issueContinuation,
  requestJoin,
} from "../apps/server/dist/participation-admission.js";
import { hash, encrypt, randomToken } from "../apps/server/dist/security.js";
export const ui2Key = "c".repeat(64);
export const ui2Origin = "http://127.0.0.2:3007";
const command = (kind, payload = {}) => ({
  commandSchema: "wf2-command-1",
  commandId: randomUUID(),
  kind,
  payload,
});
export async function seedUi2(pool, extraCommunities = 19) {
  if (process.env.NODE_ENV === "production")
    throw Error("UI-2 fixture forbidden in production");
  const actors = {};
  async function actor(role, name) {
    const id = randomUUID(),
      raw = randomToken(),
      csrf = randomToken();
    await pool.query(
      "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4)",
      [id, "ui2-" + role, name, "ui2_" + role],
    );
    await pool.query(
      "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 hours',now()+interval '7 days')",
      [
        hash(raw),
        id,
        csrf,
        encrypt(
          { access_token: role, refresh_token: role, expires_in: 7200 },
          ui2Key,
        ),
      ],
    );
    return (actors[role] = {
      id,
      raw,
      csrf,
      name,
      role,
      person_id: id,
      session_hash: hash(raw),
    });
  }
  for (const [role, name] of [
    ["owner", "Mira Vale"],
    ["member", "Rowan Reed"],
    ["pending", "Jules Moss"],
    ["denied", "Kit Wren"],
    ["empty", "Alex Brook"],
    ["lost", "Robin Ash"],
    ["invited", "Casey Fern"],
  ])
    await actor(role, name);
  const baseline = generateBaseline("fern");
  async function village(creator, name) {
    const legacy = generateWorld("fern", {
      id: randomUUID(),
      name:
        creator.role === "owner"
          ? "Mira’s Grove"
          : creator.name + "’s original village",
      createdAt: new Date().toISOString(),
      source: "creator",
    });
    await pool.query(
      "INSERT INTO worlds(id,creator_id,name,seed,generator_version,asset_version,schema_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
      [
        legacy.id,
        creator.id,
        legacy.name,
        legacy.seed,
        legacy.generatorVersion,
        legacy.assetVersion,
        legacy,
      ],
    );
    const world = randomUUID(),
      job = randomUUID(),
      lease = new Date(Date.now() + 30000).toISOString();
    await pool.query(
      "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,$6,'fern','development','working',$7)",
      [job, creator.id, randomUUID(), hash(job), world, name, lease],
    );
    await publishFounding(pool, job, baseline, lease);
    const config = {
      databaseUrl: "unused",
      clientId: "synthetic",
      clientSecret: "unused",
      redirectUri: ui2Origin + "/auth/twitch/callback",
      webOrigin: ui2Origin,
      encryptionKey: ui2Key,
      secureCookies: false,
      wf2WorldId: world,
    };
    await activate(
      pool,
      config,
      creator,
      command("EnablePlaytest", { expectedBaselineHash: baseline.hash }),
      world,
    );
    return { id: world, config, creator, legacyWorld: legacy.id };
  }
  const main = await village(actors.owner, "Willow Workshop");
  async function invite(world) {
    const issued = await admissionCommand(
      pool,
      world.config,
      world.creator,
      world.id,
      command("IssueInvitation"),
    );
    const link = await invitationLink(
      pool,
      world.config,
      world.creator,
      world.id,
      issued.inviteId,
    );
    return {
      url: link.url,
      continuation: await issueContinuation(pool, link.url.split("=")[1]),
    };
  }
  async function join(world, person, state = "approved") {
    const invitation = await invite(world),
      c = invitation.continuation;
    const result = await requestJoin(
      pool,
      person,
      command("RequestJoin", { continuationId: c.continuationId }),
      c.cookie,
    );
    if (state !== "pending")
      await admissionCommand(
        pool,
        world.config,
        world.creator,
        world.id,
        command(state === "approved" ? "ApproveRequest" : "RejectRequest", {
          requestId: result.requestId,
          expectedRequestRevision: "1",
        }),
      );
    return result.requestId;
  }
  await join(main, actors.member);
  await join(main, actors.pending, "pending");
  await join(main, actors.denied, "rejected");
  await join(main, actors.lost);
  await admissionCommand(
    pool,
    main.config,
    actors.lost,
    main.id,
    command("LeaveCommunity"),
  );
  const freshInvitation = await invite(main);
  const host = await actor("host", "Sol Finch"),
    shared = await village(host, "Juniper Hollow");
  await join(shared, actors.owner);
  await join(shared, actors.member);
  for (let i = 0; i < extraCommunities; i++) {
    const creator = await actor("host" + i, "Creator " + (i + 1));
    const world = await village(
      creator,
      "Woodland Circle " + String(i + 1).padStart(2, "0"),
    );
    await join(world, actors.member);
  }
  return {
    actors,
    mainWorld: main.id,
    legacyWorld: main.legacyWorld,
    sharedWorld: shared.id,
    invitation: freshInvitation,
    expectedJoined: extraCommunities + 2,
  };
}
