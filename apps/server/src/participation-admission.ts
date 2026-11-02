import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { isWf2Batch, type Wf2Command } from "@creators-village/contracts";
import type { Config } from "./config.js";
import { encrypt, decrypt, hash, randomToken } from "./security.js";
import {
  authority,
  fail,
  lockSession,
  memberLimit,
  priorReceipt,
  receipt,
  transaction,
  type Actor,
  canonical,
} from "./participation-core.js";
export const admissionKinds = new Set([
  "IssueInvitation",
  "RevokeInvitation",
  "ApproveRequest",
  "RejectRequest",
  "LeaveCommunity",
  "BanMember",
  "UnbanMember",
]);
export async function issueContinuation(pool: Pool, token: string) {
  const invite = (
    await pool.query(
      "SELECT id,expires_at FROM wf2_invitations WHERE token_hash=$1 AND consumed_request_id IS NULL AND revoked_at IS NULL AND expires_at>now()",
      [hash(token)],
    )
  ).rows[0];
  if (!invite) fail("INVITE_EXPIRED", 410);
  const id = randomUUID(),
    cookie = randomToken();
  await pool.query(
    "INSERT INTO wf2_join_continuations(id,cookie_hash,invitation_id,expires_at) VALUES($1,$2,$3,$4)",
    [id, hash(cookie), invite.id, invite.expires_at],
  );
  return {
    cookie,
    continuationId: id,
    expiresAt: invite.expires_at.toISOString(),
  };
}
export async function requestJoin(
  pool: Pool,
  actor: Actor,
  command: Wf2Command,
  cookie: string | undefined,
) {
  const p = command.payload as { continuationId: string };
  return transaction(pool, async (db) => {
    await lockSession(db, actor);
    // Retry of an immutable own receipt requires no remaining bearer cookie.
    const input = { ...command };
    const accepted = (
      await db.query(
        "SELECT request_hash,result FROM wf2_command_receipts WHERE person_id=$1 AND command_id=$2",
        [actor.person_id, command.commandId],
      )
    ).rows[0];
    if (accepted) {
      if (accepted.request_hash !== hash(canonical(input)))
        fail("COMMAND_ID_REUSED");
      return accepted.result;
    }
    const context = (
      await db.query(
        "SELECT c.*,i.world_id FROM wf2_join_continuations c JOIN wf2_invitations i ON i.id=c.invitation_id WHERE c.id=$1",
        [p.continuationId],
      )
    ).rows[0];
    if (!context) fail("INVITE_EXPIRED", 410);
    const b = (
      await db.query(
        "SELECT * FROM wf2_bindings WHERE world_id=$1 AND enabled FOR UPDATE",
        [context.world_id],
      )
    ).rows[0];
    if (!b) fail("INVITE_EXPIRED", 410);
    const old = await priorReceipt(db, actor, command.commandId, input);
    if (old) return old;
    if (
      !cookie ||
      hash(cookie) !== context.cookie_hash ||
      context.expires_at.getTime() <= Date.now()
    )
      fail("INVITE_EXPIRED", 410);
    const i = (
      await db.query("SELECT * FROM wf2_invitations WHERE id=$1 FOR UPDATE", [
        context.invitation_id,
      ])
    ).rows[0]!;
    if (i.revoked_at || i.expires_at.getTime() <= Date.now())
      fail("INVITE_EXPIRED", 410);
    if (i.consumed_request_id) fail("INVITE_USED");
    const m = (
      await db.query(
        "SELECT * FROM wf2_memberships WHERE community_id=$1 AND person_id=$2 FOR UPDATE",
        [b.community_id, actor.person_id],
      )
    ).rows[0];
    if (
      m?.state === "banned" ||
      m?.state === "active" ||
      m?.state === "pending"
    )
      fail("FORBIDDEN", 403);
    await db.query(
      "INSERT INTO wf2_memberships(id,community_id,person_id,state) VALUES($1,$2,$3,'pending') ON CONFLICT(community_id,person_id) DO UPDATE SET state='pending',revision=wf2_memberships.revision+1,changed_at=now()",
      [randomUUID(), b.community_id, actor.person_id],
    );
    const id = randomUUID();
    await db.query(
      "INSERT INTO wf2_join_requests(id,world_id,community_id,person_id,invitation_id,state) VALUES($1,$2,$3,$4,$5,'pending')",
      [id, b.world_id, b.community_id, actor.person_id, i.id],
    );
    await db.query(
      "UPDATE wf2_invitations SET consumed_request_id=$1,sealed_token=NULL WHERE id=$2",
      [id, i.id],
    );
    await db.query(
      "UPDATE wf2_join_continuations SET completed_request_id=$1 WHERE id=$2",
      [id, context.id],
    );
    return receipt(db, actor, command, b.world_id, input, {
      requestId: id,
      state: "pending",
    });
  });
}
export async function admissionCommand(
  pool: Pool,
  config: Config,
  actor: Actor,
  world: string,
  command: Wf2Command,
) {
  return transaction(pool, async (db) => {
    const p = command.payload as Record<string, any>,
      leave = command.kind === "LeaveCommunity";
    // Binding serializes membership capacity, leave/ban/approval and request eligibility.
    let b: Record<string, any>;
    if (leave) {
      await lockSession(db, actor);
      b = (
        await db.query(
          "SELECT * FROM wf2_bindings WHERE world_id=$1 AND enabled FOR UPDATE",
          [world],
        )
      ).rows[0];
      if (!b) fail("NOT_FOUND", 404);
      b.membership = (
        await db.query(
          "SELECT * FROM wf2_memberships WHERE community_id=$1 AND person_id=$2 FOR UPDATE",
          [b.community_id, actor.person_id],
        )
      ).rows[0];
      if (!b.membership || !["active", "pending"].includes(b.membership.state))
        fail("NOT_FOUND", 404);
    } else b = await authority(db, world, actor, true, true, "can_moderate");
    const input = { worldId: world, ...command },
      old = await priorReceipt(db, actor, command.commandId, input);
    if (old) return old;
    let result: unknown;
    if (command.kind === "IssueInvitation") {
      const id = randomUUID(),
        token = randomToken();
      const r = (
        await db.query(
          "INSERT INTO wf2_invitations(id,world_id,issued_by,token_hash,sealed_token,created_at,expires_at) VALUES($1,$2,$3,$4,$5,date_trunc('milliseconds',now()),date_trunc('milliseconds',now())+interval '24 hours') RETURNING expires_at",
          [
            id,
            world,
            actor.person_id,
            hash(token),
            Buffer.from(
              encrypt(
                { purpose: "wf2-invitation", token },
                config.encryptionKey,
              ),
            ),
          ],
        )
      ).rows[0]!;
      result = { inviteId: id, expiresAt: r.expires_at.toISOString() };
    } else if (command.kind === "RevokeInvitation") {
      if (
        !(
          await db.query(
            "UPDATE wf2_invitations SET revoked_at=COALESCE(revoked_at,now()),sealed_token=NULL WHERE id=$1 AND world_id=$2 AND consumed_request_id IS NULL",
            [p.inviteId, world],
          )
        ).rowCount
      )
        fail("NOT_FOUND", 404);
      result = { inviteId: p.inviteId, revoked: true };
    } else if (
      command.kind === "ApproveRequest" ||
      command.kind === "RejectRequest"
    ) {
      const r = (
        await db.query(
          "SELECT * FROM wf2_join_requests WHERE id=$1 AND world_id=$2 FOR UPDATE",
          [p.requestId, world],
        )
      ).rows[0];
      if (!r) fail("NOT_FOUND", 404);
      if (r.state !== "pending" || r.revision !== p.expectedRequestRevision)
        fail("STALE_TARGET");
      const m = (
        await db.query(
          "SELECT * FROM wf2_memberships WHERE community_id=$1 AND person_id=$2 FOR UPDATE",
          [b.community_id, r.person_id],
        )
      ).rows[0]!;
      if (m.state !== "pending") fail("STALE_TARGET");
      const approve = command.kind === "ApproveRequest";
      if (approve) {
        const n = (
          await db.query(
            "SELECT count(*)::int AS n FROM wf2_memberships WHERE community_id=$1 AND state='active' AND person_id<>$2",
            [b.community_id, b.creator_id],
          )
        ).rows[0]!.n;
        // Legacy ruleset cap unless the creator configured community settings.
        if (n >= (await memberLimit(db, b as never))) fail("COHORT_LIMIT");
      }
      await db.query(
        "UPDATE wf2_memberships SET state=$1,join_source=CASE WHEN $1='active' THEN 'invitation' ELSE join_source END,revision=revision+1,changed_at=now() WHERE community_id=$2 AND person_id=$3",
        [approve ? "active" : "rejected", b.community_id, r.person_id],
      );
      await db.query(
        "UPDATE wf2_join_requests SET state=$1,revision=revision+1,decided_at=now() WHERE id=$2",
        [approve ? "approved" : "rejected", r.id],
      );
      if (approve)
        await db.query(
          "INSERT INTO wf2_world_grants(world_id,community_id,person_id,can_view,can_contribute) VALUES($1,$2,$3,true,true) ON CONFLICT(world_id,person_id) DO UPDATE SET can_view=true,can_contribute=true,revoked_at=NULL,revision=wf2_world_grants.revision+1",
          [world, b.community_id, r.person_id],
        );
      result = approve
        ? { requestId: r.id, memberId: m.id, state: "active" }
        : { requestId: r.id, state: "rejected" };
    } else {
      const m = leave
        ? b.membership
        : (
            await db.query(
              "SELECT * FROM wf2_memberships WHERE id=$1 AND community_id=$2 FOR UPDATE",
              [p.memberId, b.community_id],
            )
          ).rows[0];
      if (!m || m.person_id === b.creator_id) fail("FORBIDDEN", 403);
      if (!leave && m.revision !== p.expectedMembershipRevision)
        fail("STALE_TARGET");
      // A delegated moderator cannot act on another moderator; only the creator can.
      if (!leave && actor.person_id !== b.creator_id) {
        const target = (
          await db.query(
            "SELECT can_moderate FROM wf2_world_grants WHERE world_id=$1 AND person_id=$2",
            [world, m.person_id],
          )
        ).rows[0];
        if (m.person_id === actor.person_id || target?.can_moderate)
          fail("FORBIDDEN", 403);
      }
      if (command.kind === "UnbanMember" && m.state !== "banned")
        fail("STALE_TARGET");
      const state = command.kind === "BanMember" ? "banned" : "left";
      await db.query(
        "UPDATE wf2_memberships SET state=$1,revision=revision+1,changed_at=now() WHERE community_id=$2 AND person_id=$3",
        [state, b.community_id, m.person_id],
      );
      await db.query(
        "UPDATE wf2_world_grants SET can_view=false,can_contribute=false,can_create_projects=false,can_manage_construction=false,can_moderate=false,revoked_at=now(),revision=revision+1 WHERE world_id=$1 AND person_id=$2",
        [world, m.person_id],
      );
      await db.query(
        "UPDATE wf2_join_requests SET state='withdrawn',revision=revision+1,decided_at=now() WHERE world_id=$1 AND person_id=$2 AND state='pending'",
        [world, m.person_id],
      );
      const changed = await db.query(
        "UPDATE wf2_credit_consents SET opted_in=false,revision=revision+1,changed_at=now() WHERE world_id=$1 AND person_id=$2 AND opted_in RETURNING project_id",
        [world, m.person_id],
      );
      const orbChanged = await db.query(
        "UPDATE f3_orb_participants SET opted_in=false,revision=revision+1,changed_at=now() WHERE world_id=$1 AND person_id=$2 AND opted_in RETURNING project_id",
        [world, m.person_id],
      );
      changed.rows.push(...orbChanged.rows);
      // Invalidation is projected separately from private membership changes.
      if (changed.rows.length)
        await suppressCredit(
          db,
          world,
          changed.rows.map((r) => r.project_id),
        );
      result = leave ? { state } : { memberId: m.id, state };
    }
    await db.query(
      "UPDATE wf2_bindings SET authority_epoch=authority_epoch+1 WHERE world_id=$1",
      [world],
    );
    return receipt(db, actor, command, world, input, result);
  });
}
// Head is locked last; no actor names/private membership reasons are streamed.
export async function suppressCredit(
  db: PoolClient,
  world: string,
  projects: string[],
) {
  const b = (
    await db.query(
      "UPDATE wf2_bindings SET credit_revision=credit_revision+1 WHERE world_id=$1 RETURNING credit_revision",
      [world],
    )
  ).rows[0]!;
  const w = (
    await db.query(
      "UPDATE founding_worlds SET public_cursor=public_cursor+1 WHERE id=$1 RETURNING public_cursor,topology_epoch",
      [world],
    )
  ).rows[0]!;
  const payload = {
    batchSchema: "wf2-batch-1",
    worldId: world,
    batchId: randomUUID(),
    fromCursor: (BigInt(w.public_cursor) - 1n).toString(),
    toCursor: w.public_cursor,
    kind: "RecognitionChanged",
    changes: projects.map((id) => ({
      type: "creditInvalidation",
      projectId: id,
    })),
    topologyEpoch: w.topology_epoch,
    creditRevision: b.credit_revision,
    changedChunks: [],
  };
  if (
    !isWf2Batch(payload) ||
    Buffer.byteLength(JSON.stringify(payload)) > 65536
  )
    throw Error("Invalid recognition projection");
  await db.query(
    "INSERT INTO wf2_shared_batches(world_id,cursor,batch_id,batch_schema,payload,committed_at) VALUES($1,$2,$3,'wf2-batch-1',$4,clock_timestamp())",
    [world, w.public_cursor, payload.batchId, payload],
  );
  await db.query(
    "INSERT INTO wf2_outbox(world_id,cursor,state,next_attempt_at,attempt) VALUES($1,$2,'pending',now(),0)",
    [world, w.public_cursor],
  );
}
export async function invitationLink(
  pool: Pool,
  config: Config,
  actor: Actor,
  world: string,
  id: string,
) {
  return transaction(pool, async (db) => {
    await authority(db, world, actor, false, true, "can_moderate");
    const r = (
      await db.query(
        "SELECT sealed_token,expires_at FROM wf2_invitations WHERE id=$1 AND world_id=$2 AND sealed_token IS NOT NULL AND consumed_request_id IS NULL AND revoked_at IS NULL AND expires_at>now()",
        [id, world],
      )
    ).rows[0];
    if (!r) fail("INVITE_EXPIRED", 410);
    const v = decrypt<{ purpose: string; token: string }>(
      r.sealed_token.toString(),
      config.encryptionKey,
    );
    if (v.purpose !== "wf2-invitation") throw Error("Invalid token purpose");
    return {
      url: "/join#request=" + v.token,
      expiresAt: r.expires_at.toISOString(),
    };
  });
}
