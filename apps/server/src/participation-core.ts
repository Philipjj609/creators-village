import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Config } from "./config.js";
import { hash } from "./security.js";
import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./database.js";
import {
  readFoundingWorld,
  baselineDigest,
} from "@creators-village/world/founding";
export type Actor = { person_id: string; session_hash: string };
export class Wf2Error extends Error {
  constructor(
    public code: string,
    public status = 409,
    public retryable = false,
  ) {
    super(code);
  }
}
export function fail(code: string, status = 409): never {
  throw new Wf2Error(code, status);
}
export async function transaction<T>(
  pool: Pool,
  action: (db: PoolClient) => Promise<T>,
  isolation: "READ COMMITTED" | "REPEATABLE READ" = "READ COMMITTED",
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL " + isolation);
      await db.query("SET LOCAL transaction_timeout='10s'");
      await db.query("SET LOCAL lock_timeout='2s'");
      await db.query("SET LOCAL statement_timeout='10s'");
      const value = await action(db);
      await db.query("COMMIT");
      return value;
    } catch (e) {
      try {
        await db.query("ROLLBACK");
      } catch {
        /* A killed connection cannot roll back; retain the original failure. */
      }
      if (
        attempt < 2 &&
        ["40001", "40P01", "55P03"].includes((e as { code: string }).code)
      ) {
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
        continue;
      }
      throw e;
    } finally {
      db.release();
    }
  }
}
export async function lockSession(db: PoolClient, actor: Actor) {
  if (
    !(
      await db.query(
        "SELECT session_hash FROM sessions WHERE session_hash=$1 AND person_id=$2 AND expires_at>now() AND validated_at>now()-interval '60 minutes' FOR SHARE",
        [actor.session_hash, actor.person_id],
      )
    ).rowCount
  )
    fail("AUTH_REQUIRED", 403);
}
/**
 * Membership is only the right to view. Everything else is a separate grant column:
 * contribute Orbs, create projects, manage construction, moderate members. The creator is
 * identified by the binding, never by a grant, and always holds every permission.
 */
export type Permission =
  | "can_contribute"
  | "can_create_projects"
  | "can_manage_construction"
  | "can_moderate";
export const PERMISSIONS: readonly Permission[] = [
  "can_contribute",
  "can_create_projects",
  "can_manage_construction",
  "can_moderate",
];
/**
 * `creatorOnly` keeps its R1 meaning when no permission is named. When permissions are
 * named, the creator or a member holding any one of them passes.
 */
export async function authority(
  db: PoolClient,
  world: string,
  actor: Actor,
  exclusive = false,
  creatorOnly = false,
  permission?: Permission | Permission[],
) {
  await lockSession(db, actor);
  const b = (
    await db.query(
      `SELECT * FROM wf2_bindings WHERE world_id=$1 AND enabled FOR ${exclusive ? "UPDATE" : "SHARE"}`,
      [world],
    )
  ).rows[0];
  if (!b) fail("NOT_FOUND", 404);
  const m = (
    await db.query(
      "SELECT m.*,g.can_view,g.can_contribute,g.can_create_projects,g.can_manage_construction,g.can_moderate FROM wf2_memberships m JOIN wf2_world_grants g ON g.community_id=m.community_id AND g.person_id=m.person_id WHERE g.world_id=$1 AND m.person_id=$2 FOR SHARE OF m,g",
      [world, actor.person_id],
    )
  ).rows[0];
  if (!m || m.state !== "active" || !m.can_view) fail("NOT_FOUND", 404);
  if (creatorOnly && b.creator_id !== actor.person_id) {
    const needed = permission === undefined ? [] : [permission].flat();
    if (!needed.some((p) => m[p] === true)) fail("FORBIDDEN", 403);
  }
  return { ...b, membership: m };
}
/** Effective non-creator membership bound: per-community setting if present, else the legacy ruleset cap. */
export async function memberLimit(
  db: PoolClient,
  binding: { community_id: string; ruleset_id: string },
) {
  const configured = (
    await db.query(
      "SELECT member_limit FROM wf2_community_settings WHERE community_id=$1",
      [binding.community_id],
    )
  ).rows[0];
  if (configured) return configured.member_limit as number;
  return (
    await db.query(
      "SELECT max_non_creator_members FROM wf2_rulesets WHERE id=$1",
      [binding.ruleset_id],
    )
  ).rows[0]!.max_non_creator_members as number;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(
      typeof value === "string" ? value.normalize("NFC") : value,
    );
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export async function priorReceipt(
  db: PoolClient,
  actor: Actor,
  commandId: string,
  input: unknown,
) {
  // Same actor+command even across different target worlds serializes before absent receipt insertion.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,17))", [
    actor.person_id + ":" + commandId,
  ]);
  const old = (
    await db.query(
      "SELECT request_hash,result FROM wf2_command_receipts WHERE person_id=$1 AND command_id=$2",
      [actor.person_id, commandId],
    )
  ).rows[0];
  if (old && old.request_hash !== hash(canonical(input)))
    fail("COMMAND_ID_REUSED");
  return old?.result;
}
export async function receipt(
  db: PoolClient,
  actor: Actor,
  command: { commandId: string; commandSchema: string; kind: string },
  world: string | null,
  input: unknown,
  result: unknown,
) {
  await db.query(
    "INSERT INTO wf2_command_receipts(person_id,command_id,command_schema,kind,target_world_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      actor.person_id,
      command.commandId,
      command.commandSchema,
      command.kind,
      world,
      hash(canonical(input)),
      result,
    ],
  );
  return result;
}
export async function verifyBaseline(
  db: PoolClient,
  world: string,
  row: { header: unknown; baseline_hash: string },
) {
  let header;
  try {
    header = readFoundingWorld(row.header);
  } catch {
    fail("UNSUPPORTED_SCHEMA", 400);
  }
  if (
    header.id !== world ||
    header.baseline.min !== -256 ||
    header.baseline.hash !== row.baseline_hash
  )
    fail("UNSUPPORTED_SCHEMA", 400);
  const chunks = (
    await db.query<{ x: number; y: number; hash: string; revision: string }>(
      "SELECT x,y,hash,revision FROM founding_chunks WHERE world_id=$1 ORDER BY y,x",
      [world],
    )
  ).rows;
  if (
    chunks.length !== 256 ||
    baselineDigest({ ...header.baseline, chunks }) !== row.baseline_hash
  )
    fail("UNSUPPORTED_SCHEMA", 400);
  return chunks;
}
export async function activate(
  pool: Pool,
  config: Config,
  actor: Actor,
  command: {
    commandId: string;
    commandSchema: string;
    kind: string;
    payload: { expectedBaselineHash: string };
  },
  world: string,
) {
  if (!config.wf2WorldId || config.wf2WorldId !== world) fail("NOT_FOUND", 404);
  return transaction(pool, async (db) => {
    await lockSession(db, actor);
    await db.query("SELECT id FROM people WHERE id=$1 FOR UPDATE", [
      actor.person_id,
    ]);
    const w = (
      await db.query(
        "SELECT * FROM founding_worlds WHERE id=$1 AND creator_id=$2 AND purpose='development' FOR UPDATE",
        [world, actor.person_id],
      )
    ).rows[0];
    if (!w) fail("NOT_FOUND", 404);
    await verifyBaseline(db, world, w);
    if (w.header?.id !== world || w.header?.baseline?.hash !== w.baseline_hash)
      fail("UNSUPPORTED_SCHEMA", 400);
    if (w.baseline_hash !== command.payload.expectedBaselineHash)
      fail("PLAN_CHANGED");
    const input = { worldId: world, ...command };
    const old = await priorReceipt(db, actor, command.commandId, input);
    if (old) return old;
    let b = (
      await db.query("SELECT * FROM wf2_bindings WHERE world_id=$1", [world])
    ).rows[0];
    if (b && !b.enabled) fail("FORBIDDEN", 403);
    if (!b) {
      const community = randomUUID();
      await db.query(
        "INSERT INTO wf2_communities(id,creator_id) VALUES($1,$2)",
        [community, actor.person_id],
      );
      await db.query(
        "INSERT INTO wf2_bindings(world_id,community_id,creator_id,ruleset_id,state_schema,enabled) VALUES($1,$2,$3,'cp1-wf2-test-1','wf2-state-1',true)",
        [world, community, actor.person_id],
      );
      await db.query("INSERT INTO wf2_topology_guards VALUES($1)", [world]);
      await db.query(
        "INSERT INTO wf2_memberships(id,community_id,person_id,state) VALUES($1,$2,$3,'active')",
        [randomUUID(), community, actor.person_id],
      );
      await db.query(
        "INSERT INTO wf2_world_grants(world_id,community_id,person_id,can_view,can_contribute) VALUES($1,$2,$3,true,true)",
        [world, community, actor.person_id],
      );
      const copied = await db.query(
        "INSERT INTO wf2_claims(world_id,surface,hx,hy,kind,structure_id) SELECT world_id,surface,hx,hy,'solid',structure_id FROM founding_occupancy WHERE world_id=$1 RETURNING hx,hy",
        [world],
      );
      if (copied.rowCount !== 24)
        throw Error("Founding claim preflight failed");
      b = { community_id: community };
    }
    return receipt(db, actor, command, world, input, {
      worldId: world,
      communityId: b.community_id,
      stateSchema: "wf2-state-1",
    });
  });
}
export function projectDto(p: Record<string, any>) {
  return {
    ...(p.ruleset_id === "community-orbs-1"
      ? {
          fundingModel: "community-orbs-1" as const,
          ...(p.path_extension
            ? {
                pathExtension: {
                  points: p.path_extension,
                  widthQ: p.path_width_q,
                },
              }
            : {}),
        }
      : {}),
    id: p.id,
    revision: p.revision,
    planRevision: p.plan_revision,
    planHash: p.plan_hash,
    state: p.state,
    goal: p.goal,
    acceptedCount: p.accepted_count,
    nonCreatorConditionMet: p.non_creator_count >= p.minimum_non_creator,
    blockedCode: p.blocked_code,
    template: p.template_id,
    site: {
      qx: p.qx,
      qy: p.qy,
      baseHeight: p.base_height,
      widthQ: p.width_q,
      depthQ: p.depth_q,
      entrance: { qx: p.entrance_qx, qy: p.entrance_qy },
      appearance: p.appearance,
      assetManifestHash: p.asset_manifest_hash,
    },
    path: { points: p.path_points, widthQ: p.path_width_q },
  };
}
export function structureDto(
  s: Record<string, any>,
  manifestHash: string | null = null,
) {
  return {
    id: s.id,
    template: s.template,
    position: { qx: s.qx, qy: s.qy, height: s.height },
    footprint: { widthQ: s.width, depthQ: s.depth },
    entrance: { qx: s.entrance_qx, qy: s.entrance_qy },
    appearance: s.appearance,
    assetManifestHash: manifestHash,
    revision: s.revision,
  };
}
export function pathDto(p: Record<string, any>) {
  return {
    id: p.id,
    widthQ: p.width,
    points: p.geometry.map((v: any) =>
      "qx" in v ? v : { qx: v.x * 256, qy: v.y * 256 },
    ),
    revision: "1",
  };
}
export async function bootstrap(pool: Pool, actor: Actor, world: string) {
  const calibration = JSON.parse(
    await fs.readFile(
      path.join(
        repositoryRoot,
        "docs/testing/evidence/wf2/source-calibration.json",
      ),
      "utf8",
    ),
  );
  return transaction(
    pool,
    async (db) => {
      const b = await authority(db, world, actor);
      const w = (
        await db.query("SELECT * FROM founding_worlds WHERE id=$1", [world])
      ).rows[0]!;
      const baselineChunks = await verifyBaseline(db, world, w);
      try {
        readFoundingWorld(w.header);
      } catch {
        fail("UNSUPPORTED_SCHEMA", 400);
      }
      if (
        w.header?.id !== world ||
        w.header?.baseline?.hash !== w.baseline_hash
      )
        fail("UNSUPPORTED_SCHEMA", 400);
      const structures = (
        await db.query(
          "SELECT s.*,p.asset_manifest_hash FROM founding_structures s LEFT JOIN wf2_completion_results r ON r.world_id=s.world_id AND r.structure_id=s.id LEFT JOIN wf2_projects p ON p.world_id=r.world_id AND p.id=r.project_id WHERE s.world_id=$1 ORDER BY s.id",
          [world],
        )
      ).rows.map((s) =>
        structureDto(
          s,
          s.asset_manifest_hash ?? calibration.assetManifestSha256,
        ),
      );
      const paths = (
        await db.query(
          "SELECT id,width,geometry FROM founding_paths WHERE world_id=$1 ORDER BY id",
          [world],
        )
      ).rows.map(pathDto);
      const projects = (
        await db.query(
          "SELECT * FROM wf2_projects WHERE world_id=$1 AND published_at IS NOT NULL ORDER BY created_at,id",
          [world],
        )
      ).rows.map(projectDto);
      const chunks = baselineChunks.map(({ x, y, revision }) => ({
        x,
        y,
        revision,
      }));
      return {
        stateSchema: "wf2-state-1",
        worldId: world,
        baseline: w.header.baseline,
        active: w.header.active,
        cursor: w.public_cursor,
        topologyEpoch: w.topology_epoch,
        creditRevision: b.credit_revision,
        replayFloor: b.replay_floor,
        structures,
        paths,
        projects,
        currentChunkRevisions: chunks,
      };
    },
    "REPEATABLE READ",
  );
}
