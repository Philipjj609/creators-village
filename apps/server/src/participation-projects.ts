import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { isWf2Batch, type Wf2Command } from "@creators-village/contracts";
import {
  authority,
  fail,
  priorReceipt,
  receipt,
  transaction,
  projectDto,
  structureDto,
  pathDto,
  type Actor,
} from "./participation-core.js";
import { lockTopology, planAt } from "./participation-spatial.js";
import { suppressCredit } from "./participation-admission.js";
export async function publishBatch(
  db: PoolClient,
  world: string,
  kind: string,
  changes: unknown[],
  spatial = false,
) {
  const b = (
    await db.query(
      "SELECT credit_revision FROM wf2_bindings WHERE world_id=$1",
      [world],
    )
  ).rows[0]!;
  const chunks = spatial
    ? (
        await db.query(
          "UPDATE founding_chunks SET revision=revision+1 WHERE world_id=$1 AND x BETWEEN -2 AND 1 AND y BETWEEN -2 AND 1 RETURNING x,y,revision",
          [world],
        )
      ).rows
    : [];
  const w = (
    await db.query(
      "UPDATE founding_worlds SET public_cursor=public_cursor+1,topology_epoch=topology_epoch+$2 WHERE id=$1 RETURNING public_cursor,topology_epoch",
      [world, spatial ? 1 : 0],
    )
  ).rows[0]!;
  const batch = {
    batchSchema: "wf2-batch-1",
    worldId: world,
    batchId: randomUUID(),
    fromCursor: (BigInt(w.public_cursor) - 1n).toString(),
    toCursor: w.public_cursor,
    kind,
    changes,
    topologyEpoch: w.topology_epoch,
    creditRevision: b.credit_revision,
    changedChunks: chunks,
  };
  if (!isWf2Batch(batch) || Buffer.byteLength(JSON.stringify(batch)) > 65536)
    throw Error("Invalid shared projection batch");
  await db.query(
    "INSERT INTO wf2_shared_batches(world_id,cursor,batch_id,batch_schema,payload,committed_at) VALUES($1,$2,$3,'wf2-batch-1',$4,clock_timestamp())",
    [world, w.public_cursor, batch.batchId, batch],
  );
  await db.query(
    "INSERT INTO wf2_outbox(world_id,cursor,state,next_attempt_at,attempt) VALUES($1,$2,'pending',now(),0)",
    [world, w.public_cursor],
  );
  return w.public_cursor as string;
}
export async function projectCommand(
  pool: Pool,
  actor: Actor,
  world: string,
  command: Wf2Command,
) {
  const p = command.payload as Record<string, any>,
    recognition = command.kind === "SetRecognition";
  return transaction(pool, async (db) => {
    const b = await authority(
      db,
      world,
      actor,
      recognition || Boolean(p.recognitionOptIn),
      !["Contribute", "SetRecognition"].includes(command.kind),
    );
    if (command.kind === "Contribute" && !b.membership.can_contribute)
      fail("FORBIDDEN", 403);
    const input = { worldId: world, ...command },
      old = await priorReceipt(db, actor, command.commandId, input);
    if (old) return old;
    const spatial = [
      "PublishProject",
      "CancelProject",
      "RetryCompletion",
    ].includes(command.kind);
    if (spatial) await lockTopology(db, world);
    let project = p.projectId
      ? (
          await db.query(
            "SELECT * FROM wf2_projects WHERE world_id=$1 AND id=$2 FOR UPDATE",
            [world, p.projectId],
          )
        ).rows[0]
      : null;
    if (p.projectId && !project) fail("NOT_FOUND", 404);
    if (
      p.expectedProjectRevision &&
      project.revision !== p.expectedProjectRevision
    )
      fail("STALE_TARGET");
    let result: Record<string, unknown>;
    if (command.kind === "CreateDraft" || command.kind === "ReviseDraft") {
      if (project && project.state !== "draft") fail("PROJECT_NOT_OPEN");
      const plan = await planAt(db, world, p.site.qx, p.site.qy);
      const {
        claims: _claims,
        rect: _rect,
        baseline_hash: _baseline,
        ...fields
      } = plan;
      if (!project) {
        const id = randomUUID(),
          columns = Object.keys(fields);
        project = (
          await db.query(
            `INSERT INTO wf2_projects(id,community_id,created_by,state,${columns.join(",")}) VALUES($1,$2,$3,'draft',${columns.map((_, i) => "$" + (i + 4)).join(",")}) RETURNING *`,
            [
              id,
              b.community_id,
              actor.person_id,
              ...columns.map((k) =>
                k === "path_points"
                  ? JSON.stringify((fields as any)[k])
                  : (fields as any)[k],
              ),
            ],
          )
        ).rows[0];
      } else {
        const columns = Object.keys(fields).filter((k) => k !== "world_id");
        project = (
          await db.query(
            `UPDATE wf2_projects SET ${columns.map((k, i) => k + "=$" + (i + 3)).join(",")},revision=revision+1,plan_revision=plan_revision+1 WHERE world_id=$1 AND id=$2 RETURNING *`,
            [
              world,
              project.id,
              ...columns.map((k) =>
                k === "path_points"
                  ? JSON.stringify((fields as any)[k])
                  : (fields as any)[k],
              ),
            ],
          )
        ).rows[0];
      }
      result = {
        projectId: project.id,
        projectRevision: project.revision,
        planRevision: project.plan_revision,
        planHash: project.plan_hash,
      };
    } else if (command.kind === "PublishProject") {
      if (project.state !== "draft") fail("PROJECT_NOT_OPEN");
      if (project.plan_hash !== p.planHash) fail("PLAN_CHANGED");
      if (
        (
          await db.query(
            "SELECT id FROM wf2_projects WHERE world_id=$1 AND state IN('open','ready','blocked')",
            [world],
          )
        ).rowCount
      )
        fail("ACTIVE_PROJECT_LIMIT");
      const plan = await planAt(db, world, project.qx, project.qy, project);
      for (const key of plan.claims) {
        const [hx, hy] = key.split(",").map(Number);
        await db.query(
          "INSERT INTO wf2_claims(world_id,surface,hx,hy,kind,project_id) VALUES($1,'ground',$2,$3,'reserved',$4)",
          [world, hx, hy, project.id],
        );
      }
      project = (
        await db.query(
          "UPDATE wf2_projects SET state='open',published_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
          [project.id],
        )
      ).rows[0];
      const cursor = await publishBatch(
        db,
        world,
        "ProjectOpened",
        [{ type: "project", value: projectDto(project) }],
        true,
      );
      result = {
        projectId: project.id,
        state: "open",
        projectRevision: project.revision,
        committedCursor: cursor,
      };
    } else if (command.kind === "Contribute") {
      const prior = (
        await db.query(
          "SELECT id,command_id FROM wf2_contributions WHERE world_id=$1 AND project_id=$2 AND person_id=$3",
          [world, project.id, actor.person_id],
        )
      ).rows[0];
      if (prior) fail("ALREADY_CONTRIBUTED");
      if (project.plan_hash !== p.planHash) fail("PLAN_CHANGED");
      if (project.accepted_count >= project.goal) fail("TARGET_REACHED");
      if (project.state !== "open") fail("PROJECT_NOT_OPEN");
      const id = randomUUID();
      await db.query(
        "INSERT INTO wf2_contributions(id,world_id,project_id,community_id,person_id,amount,command_id) VALUES($1,$2,$3,$4,$5,1,$6)",
        [
          id,
          world,
          project.id,
          b.community_id,
          actor.person_id,
          command.commandId,
        ],
      );
      await db.query(
        "INSERT INTO wf2_credit_consents(world_id,project_id,person_id,opted_in) VALUES($1,$2,$3,$4)",
        [world, project.id, actor.person_id, p.recognitionOptIn],
      );
      project = (
        await db.query(
          "UPDATE wf2_projects SET accepted_count=accepted_count+1,non_creator_count=non_creator_count+$2,revision=revision+1 WHERE id=$1 RETURNING *",
          [project.id, actor.person_id === b.creator_id ? 0 : 1],
        )
      ).rows[0];
      const ready =
        project.accepted_count >= project.goal &&
        project.non_creator_count >= project.minimum_non_creator;
      if (ready) {
        project = (
          await db.query(
            "UPDATE wf2_projects SET state='ready' WHERE id=$1 RETURNING *",
            [project.id],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO wf2_completion_jobs(world_id,project_id,plan_hash,status,attempt,next_attempt_at) VALUES($1,$2,$3,'pending',0,now())",
          [world, project.id, project.plan_hash],
        );
      }
      if (p.recognitionOptIn)
        await db.query(
          "UPDATE wf2_bindings SET credit_revision=credit_revision+1 WHERE world_id=$1",
          [world],
        );
      const cursor = await publishBatch(
        db,
        world,
        ready ? "ProjectReady" : "WorkAccepted",
        [{ type: "project", value: projectDto(project) }],
      );
      result = {
        contributionId: id,
        projectId: project.id,
        acceptedAmount: 1,
        completionQueued: ready,
        committedCursor: cursor,
      };
    } else if (recognition) {
      const c = await changeConsent(
        db,
        world,
        project.id,
        actor.person_id,
        p.optedIn,
      );
      result = {
        projectId: project.id,
        optedIn: p.optedIn,
        consentRevision: c.revision,
      };
    } else if (command.kind === "CancelProject") {
      if (["completed", "cancelled"].includes(project.state))
        fail("PROJECT_NOT_OPEN");
      await db.query(
        "UPDATE wf2_completion_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE world_id=$1 AND project_id=$2",
        [world, project.id],
      );
      await db.query(
        "DELETE FROM wf2_claims WHERE world_id=$1 AND project_id=$2 AND kind='reserved'",
        [world, project.id],
      );
      const draft = project.state === "draft";
      project = (
        await db.query(
          "UPDATE wf2_projects SET state='cancelled',cancelled_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
          [project.id],
        )
      ).rows[0];
      if (!draft)
        await publishBatch(
          db,
          world,
          "ProjectCancelled",
          [{ type: "project", value: projectDto(project) }],
          true,
        );
      result = {
        projectId: project.id,
        state: "cancelled",
        projectRevision: project.revision,
      };
    } else if (command.kind === "RetryCompletion") {
      if (project.state !== "blocked") fail("PROJECT_NOT_OPEN");
      if (project.plan_hash !== p.planHash) fail("PLAN_CHANGED");
      project = (
        await db.query(
          "UPDATE wf2_projects SET state='ready',blocked_code=NULL,revision=revision+1 WHERE id=$1 RETURNING *",
          [project.id],
        )
      ).rows[0];
      await db.query(
        "UPDATE wf2_completion_jobs SET status='pending',attempt=0,next_attempt_at=now(),lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=now() WHERE world_id=$1 AND project_id=$2",
        [world, project.id],
      );
      await publishBatch(db, world, "ProjectReady", [
        { type: "project", value: projectDto(project) },
      ]);
      result = {
        projectId: project.id,
        state: "ready",
        projectRevision: project.revision,
      };
    } else fail("UNSUPPORTED_SCHEMA", 400);
    return receipt(db, actor, command, world, input, result);
  });
}
export async function withdrawRecognition(
  pool: Pool,
  actor: Actor,
  command: Wf2Command,
) {
  const p = command.payload as { projectId: string; optedIn: boolean };
  if (p.optedIn) fail("FORBIDDEN", 403);
  // Resolve own contribution only; do not reveal another private world's existence.
  const c = (
    await pool.query(
      "SELECT world_id FROM wf2_contributions WHERE project_id=$1 AND person_id=$2",
      [p.projectId, actor.person_id],
    )
  ).rows[0];
  if (!c) fail("NOT_FOUND", 404);
  return transaction(pool, async (db) => {
    const { lockSession } = await import("./participation-core.js");
    await lockSession(db, actor);
    await db.query(
      "SELECT world_id FROM wf2_bindings WHERE world_id=$1 FOR UPDATE",
      [c.world_id],
    );
    const input = { privacy: true, ...command },
      old = await priorReceipt(db, actor, command.commandId, input);
    if (old) return old;
    const consent = await changeConsent(
      db,
      c.world_id,
      p.projectId,
      actor.person_id,
      false,
    );
    return receipt(db, actor, command, c.world_id, input, {
      projectId: p.projectId,
      optedIn: false,
      consentRevision: consent.revision,
    });
  });
}
async function changeConsent(
  db: PoolClient,
  world: string,
  project: string,
  person: string,
  optedIn: boolean,
) {
  const changed = await db.query(
    "UPDATE wf2_credit_consents SET opted_in=$1,revision=revision+1,changed_at=now() WHERE world_id=$2 AND project_id=$3 AND person_id=$4 AND opted_in IS DISTINCT FROM $1 RETURNING revision",
    [optedIn, world, project, person],
  );
  if (changed.rowCount) {
    await suppressCredit(db, world, [project]);
    return changed.rows[0]!;
  }
  const prior = (
    await db.query(
      "SELECT revision FROM wf2_credit_consents WHERE world_id=$1 AND project_id=$2 AND person_id=$3",
      [world, project, person],
    )
  ).rows[0];
  if (!prior) fail("NOT_FOUND", 404);
  return prior;
}
export async function leaseCompletion(pool: Pool) {
  const token = randomUUID();
  return (
    await pool.query(
      "WITH next AS (SELECT j.world_id,j.project_id FROM wf2_completion_jobs j JOIN wf2_bindings b ON b.world_id=j.world_id AND b.enabled WHERE (j.status='pending' AND j.next_attempt_at<=now()) OR (j.status='leased' AND j.lease_until<now()) ORDER BY j.next_attempt_at FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE wf2_completion_jobs j SET status='leased',lease_token=$1,lease_until=now()+interval '30 seconds',attempt=attempt+1,updated_at=now() FROM next WHERE j.world_id=next.world_id AND j.project_id=next.project_id RETURNING j.*",
      [token],
    )
  ).rows[0];
}
export async function completeConstruction(
  pool: Pool,
  job: Record<string, any>,
  fault?: (stage: string) => void,
) {
  return transaction(pool, async (db) => {
    const b = (
      await db.query(
        "SELECT * FROM wf2_bindings WHERE world_id=$1 AND enabled FOR SHARE",
        [job.world_id],
      )
    ).rows[0];
    if (!b) return false;
    await lockTopology(db, job.world_id);
    const p = (
      await db.query(
        "SELECT * FROM wf2_projects WHERE world_id=$1 AND id=$2 FOR UPDATE",
        [job.world_id, job.project_id],
      )
    ).rows[0];
    const j = (
      await db.query(
        "SELECT * FROM wf2_completion_jobs WHERE world_id=$1 AND project_id=$2 AND status='leased' AND lease_token=$3 AND lease_until>clock_timestamp() FOR UPDATE",
        [job.world_id, job.project_id, job.lease_token],
      )
    ).rows[0];
    if (!j || p?.state !== "ready") return false;
    if (
      p.plan_hash !== j.plan_hash ||
      p.accepted_count !== p.goal ||
      p.non_creator_count < p.minimum_non_creator
    )
      fail("PLAN_CHANGED");
    const plan = await planAt(db, job.world_id, p.qx, p.qy, p);
    const claims = (
      await db.query(
        "SELECT hx,hy FROM wf2_claims WHERE world_id=$1 AND project_id=$2 AND kind='reserved' ORDER BY hy,hx",
        [job.world_id, p.id],
      )
    ).rows;
    const actual = new Set(claims.map((c) => c.hx + "," + c.hy));
    if (
      actual.size !== plan.claims.length ||
      !plan.claims.every((k) => actual.has(k))
    )
      fail("PLAN_CHANGED");
    const structureId = "wf2-workshop-" + p.id,
      pathId = "wf2-path-" + p.id;
    const s = (
      await db.query(
        "INSERT INTO founding_structures(world_id,id,template,qx,qy,width,depth,height,entrance_qx,entrance_qy,appearance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [
          p.world_id,
          structureId,
          p.template_id,
          p.qx - 768,
          p.qy - 768,
          p.width_q,
          p.depth_q,
          p.base_height,
          p.entrance_qx,
          p.entrance_qy,
          p.appearance,
        ],
      )
    ).rows[0]!;
    fault?.("after-structure");
    const path = (
      await db.query(
        "INSERT INTO founding_paths(world_id,id,width,geometry) VALUES($1,$2,$3,$4) RETURNING *",
        [p.world_id, pathId, p.path_width_q, JSON.stringify(p.path_points)],
      )
    ).rows[0]!;
    await db.query(
      "UPDATE wf2_claims SET kind='solid',structure_id=$1,project_id=NULL WHERE world_id=$2 AND project_id=$3",
      [structureId, p.world_id, p.id],
    );
    const done = (
      await db.query(
        "UPDATE wf2_projects SET state='completed',completed_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
        [p.id],
      )
    ).rows[0]!;
    const fenced = await db.query(
      "UPDATE wf2_completion_jobs SET status='done',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE world_id=$1 AND project_id=$2 AND lease_token=$3 AND lease_until>clock_timestamp() RETURNING project_id",
      [p.world_id, p.id, job.lease_token],
    );
    if (!fenced.rowCount) fail("STALE_TARGET");
    const cursor = await publishBatch(
      db,
      p.world_id,
      "ConstructionCompleted",
      [
        { type: "project", value: projectDto(done) },
        { type: "structure", value: structureDto(s, p.asset_manifest_hash) },
        { type: "path", value: pathDto(path) },
      ],
      true,
    );
    await db.query(
      "INSERT INTO wf2_completion_results(world_id,project_id,structure_id,path_id,committed_cursor,completed_at) VALUES($1,$2,$3,$4,$5,now())",
      [p.world_id, p.id, structureId, pathId, cursor],
    );
    return true;
  });
}
export function completionRunner(pool: Pool, enabled: boolean) {
  let busy = false,
    closed = false,
    pending: Promise<void> = Promise.resolve();
  async function run() {
    if (busy || closed || !enabled) return;
    busy = true;
    try {
      const job = await leaseCompletion(pool);
      if (!job) return;
      try {
        await completeConstruction(pool, job);
      } catch (e) {
        await transaction(pool, async (db) => {
          const b = (
            await db.query(
              "SELECT world_id FROM wf2_bindings WHERE world_id=$1 FOR SHARE",
              [job.world_id],
            )
          ).rows[0];
          if (!b) return;
          const p = (
            await db.query(
              "SELECT * FROM wf2_projects WHERE id=$1 FOR UPDATE",
              [job.project_id],
            )
          ).rows[0];
          const j = (
            await db.query(
              "SELECT * FROM wf2_completion_jobs WHERE world_id=$1 AND project_id=$2 AND lease_token=$3 AND status='leased' FOR UPDATE",
              [job.world_id, job.project_id, job.lease_token],
            )
          ).rows[0];
          if (!j || p.state !== "ready") return;
          const transient = [
              "40001",
              "40P01",
              "55P03",
              "08006",
              "ECONNRESET",
            ].includes((e as { code: string }).code),
            blocked = !transient || j.attempt >= 4,
            code = transient ? "RETRY_EXHAUSTED" : "PLAN_OR_ASSET_INVALID";
          await db.query(
            "UPDATE wf2_completion_jobs SET status=$1,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+($2*interval '1 second'),error_code=$3,updated_at=now() WHERE world_id=$4 AND project_id=$5",
            [
              blocked ? "blocked" : "pending",
              2 ** Math.max(0, j.attempt - 1),
              code,
              job.world_id,
              job.project_id,
            ],
          );
          if (blocked) {
            const changed = (
              await db.query(
                "UPDATE wf2_projects SET state='blocked',blocked_code=$1,revision=revision+1 WHERE id=$2 RETURNING *",
                [code, job.project_id],
              )
            ).rows[0];
            await publishBatch(db, job.world_id, "CompletionBlocked", [
              { type: "project", value: projectDto(changed) },
            ]);
          }
        });
      }
    } catch {
      console.error("WF2 worker unavailable; durable intent retained");
    } finally {
      busy = false;
    }
  }
  const tick = () => {
    if (!busy && !closed) pending = run();
  };
  const timer = enabled ? setInterval(tick, 250) : null;
  timer?.unref();
  return {
    wake: tick,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await pending;
    },
  };
}
