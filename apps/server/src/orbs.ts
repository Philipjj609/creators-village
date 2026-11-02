import { checkPlacement } from "./placement.js";
import { PlacementRequest, PlacementResult } from "@creators-village/contracts";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { Wf2Auth } from "./participation-http.js";
import {
  ORB_POLICY,
  OrbDraftSchema,
  OrbFundSchema,
  type OrbDraftCommand,
  type OrbFund,
} from "@creators-village/contracts";
import {
  authority,
  transaction,
  fail,
  priorReceipt,
  receipt,
  projectDto,
  type Actor,
} from "./participation-core.js";
import { wallet, entry } from "./orb-storage.js";
import { publishBatch, projectCommand } from "./participation-projects.js";
export async function fundOrbs(
  pool: Pool,
  actor: Actor,
  world: string,
  input: OrbFund,
) {
  return transaction(pool, async (db) => {
    const b = await authority(db, world, actor, true);
    if (!b.membership.can_contribute) fail("FORBIDDEN", 403);
    const command = {
      commandSchema: "f3-command-1",
      commandId: input.commandId,
      kind: "FundOrbs",
    };
    const fingerprint = { world, ...command, payload: input };
    const old = await priorReceipt(db, actor, input.commandId, fingerprint);
    if (old) return old;
    const p = (
      await db.query(
        "SELECT * FROM wf2_projects WHERE world_id=$1 AND id=$2 FOR UPDATE",
        [world, input.projectId],
      )
    ).rows[0];
    if (!p || p.ruleset_id !== ORB_POLICY.version) fail("NOT_FOUND", 404);
    if (p.state !== "open") fail("PROJECT_NOT_OPEN");
    if (p.plan_hash !== input.planHash) fail("PLAN_CHANGED");
    if (
      !Number.isSafeInteger(input.amount) ||
      input.amount < 1 ||
      input.amount > p.goal - p.accepted_count
    )
      fail("INVALID_AMOUNT", 400);
    const w = await wallet(db, b.community_id, actor.person_id);
    if (input.amount > w.balance) fail("INSUFFICIENT_ORBS");
    const balance = w.balance - input.amount;
    await db.query(
      "UPDATE f3_orb_wallets SET balance=$3,revision=revision+1 WHERE community_id=$1 AND person_id=$2",
      [b.community_id, actor.person_id, balance],
    );
    await entry(
      db,
      b.community_id,
      actor.person_id,
      "spend:" + input.commandId,
      "spend",
      -input.amount,
      balance,
      p.id,
    );
    await db.query(
      "INSERT INTO f3_orb_participants(world_id,project_id,person_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [world, p.id, actor.person_id],
    );
    const id = randomUUID();
    await db.query(
      "INSERT INTO f3_orb_contributions(id,world_id,project_id,community_id,person_id,amount,command_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        world,
        p.id,
        b.community_id,
        actor.person_id,
        input.amount,
        input.commandId,
      ],
    );
    const updated = (
      await db.query(
        "UPDATE wf2_projects SET accepted_count=accepted_count+$2,non_creator_count=non_creator_count+$3,revision=revision+1,state=CASE WHEN accepted_count+$2=goal THEN 'ready' ELSE 'open' END WHERE id=$1 RETURNING *",
        [
          p.id,
          input.amount,
          actor.person_id === b.creator_id ? 0 : input.amount,
        ],
      )
    ).rows[0];
    if (updated.state === "ready")
      await db.query(
        "INSERT INTO wf2_completion_jobs(world_id,project_id,plan_hash,status,attempt,next_attempt_at) VALUES($1,$2,$3,'pending',0,now())",
        [world, p.id, p.plan_hash],
      );
    const cursor = await publishBatch(
      db,
      world,
      updated.state === "ready" ? "ProjectReady" : "WorkAccepted",
      [{ type: "project", value: projectDto(updated) }],
    );
    return receipt(db, actor, command, world, fingerprint, {
      contributionId: id,
      projectId: p.id,
      acceptedAmount: input.amount,
      balance,
      completionQueued: updated.state === "ready",
      committedCursor: cursor,
    });
  });
}
export async function registerOrbs(
  api: FastifyInstance,
  pool: Pool,
  config: Config,
  auth: Wf2Auth,
  wake: () => void,
) {
  const check = (world: string) => {
    if (
      !config.orbEconomy ||
      config.writesPaused ||
      world !== config.wf2WorldId
    )
      fail("NOT_FOUND", 404);
  };
  api.get<{ Params: { worldId: string } }>(
    "/worlds/:worldId/orbs/wallet",
    async (req) => {
      check(req.params.worldId);
      const a = await auth.session(req.cookies.cv_session);
      if (!a) fail("NOT_FOUND", 404);
      return transaction(pool, async (db) => {
        const b = await authority(db, req.params.worldId, a);
        if (!b.membership.can_contribute) fail("FORBIDDEN", 403);
        const w = (
          await db.query(
            "SELECT balance,revision,remainder_ms,extract(epoch FROM clock_timestamp())*1000 AS now_ms,extract(epoch FROM last_seen)*1000 AS seen_ms FROM f3_orb_wallets WHERE community_id=$1 AND person_id=$2",
            [b.community_id, a.person_id],
          )
        ).rows[0];
        if (!w) fail("NOT_FOUND", 404);
        const elapsed = Math.max(0, Number(w.now_ms) - Number(w.seen_ms));
        return {
          version: ORB_POLICY.version,
          balance: w.balance,
          revision: w.revision,
          serverTime: Number(w.now_ms),
          nextAwardInMs: Math.max(
            0,
            ORB_POLICY.intervalMs -
              w.remainder_ms -
              (elapsed <= ORB_POLICY.heartbeatGraceMs ? elapsed : 0),
          ),
          cap: ORB_POLICY.accrualCap,
          award: ORB_POLICY.award,
          intervalMs: ORB_POLICY.intervalMs,
        };
      });
    },
  );
  api.post<{ Params: { worldId: string } }>(
    "/worlds/:worldId/orbs/heartbeat",
    { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } },
    async (req) => {
      check(req.params.worldId);
      const a = await auth.mutation(req);
      if (!a) fail("AUTH_REQUIRED", 403);
      return transaction(pool, async (db) => {
        const b = await authority(db, req.params.worldId, a);
        if (!b.membership.can_contribute) fail("FORBIDDEN", 403);
        return wallet(db, b.community_id, a.person_id);
      });
    },
  );
  api.post<{
    Params: { worldId: string };
    Body: { site: { qx: number; qy: number } };
  }>(
    "/worlds/:worldId/orbs/placement-check",
    {
      schema: { body: PlacementRequest, response: { 200: PlacementResult } },
      config: { rateLimit: { max: 90, timeWindow: "1 minute" } },
    },
    async (req) => {
      check(req.params.worldId);
      const a = await auth.mutation(req);
      if (!a) fail("AUTH_REQUIRED", 403);
      return checkPlacement(
        pool,
        a,
        req.params.worldId,
        req.body.site,
        ORB_POLICY.version,
      );
    },
  );
  api.post<{ Params: { worldId: string }; Body: OrbDraftCommand }>(
    "/worlds/:worldId/orbs/drafts",
    { schema: { body: OrbDraftSchema } },
    async (req) => {
      check(req.params.worldId);
      const a = await auth.mutation(req);
      if (!a) fail("AUTH_REQUIRED", 403);
      return {
        commandId: req.body.commandId,
        status: "committed",
        result: await projectCommand(pool, a, req.params.worldId, req.body),
      };
    },
  );
  api.post<{ Params: { worldId: string }; Body: OrbFund }>(
    "/worlds/:worldId/orbs/fund",
    {
      schema: { body: OrbFundSchema },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req) => {
      check(req.params.worldId);
      const a = await auth.mutation(req);
      if (!a) fail("AUTH_REQUIRED", 403);
      const r = await fundOrbs(pool, a, req.params.worldId, req.body);
      wake();
      return r;
    },
  );
  api.get<{ Params: { worldId: string; projectId: string } }>(
    "/worlds/:worldId/orbs/projects/:projectId/history",
    async (req) => {
      check(req.params.worldId);
      const a = await auth.session(req.cookies.cv_session);
      if (!a) fail("NOT_FOUND", 404);
      return transaction(pool, async (db) => {
        await authority(db, req.params.worldId, a);
        const p = (
          await db.query(
            "SELECT state FROM wf2_projects WHERE world_id=$1 AND id=$2 AND ruleset_id=$3",
            [req.params.worldId, req.params.projectId, ORB_POLICY.version],
          )
        ).rows[0];
        if (!p || p.state === "draft") fail("NOT_FOUND", 404);
        const rows = (
          await db.query(
            `SELECT c.id,c.amount,c.at,CASE WHEN c.person_id=$3 THEN 'You' WHEN s.opted_in AND m.state='active' AND g.can_view THEN pe.display_name ELSE NULL END AS name FROM f3_orb_contributions c JOIN f3_orb_participants s USING(world_id,project_id,person_id) JOIN people pe ON pe.id=c.person_id JOIN wf2_memberships m ON m.community_id=c.community_id AND m.person_id=c.person_id JOIN wf2_world_grants g ON g.world_id=c.world_id AND g.person_id=c.person_id WHERE c.world_id=$1 AND c.project_id=$2 ORDER BY c.at DESC,c.id DESC LIMIT 60`,
            [req.params.worldId, req.params.projectId, a.person_id],
          )
        ).rows;
        return { contributions: rows };
      });
    },
  );
}
