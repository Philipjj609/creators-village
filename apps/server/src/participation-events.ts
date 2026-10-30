import type { Pool } from "pg";
import type { Socket } from "node:net";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Wf2Auth } from "./participation-http.js";
import { isWf2Batch } from "@creators-village/contracts";
const diagnostics = new WeakMap<
  FastifyInstance,
  () => {
    activeStreams: number;
    maxBufferedBytes: number;
    slowDisconnects: number;
  }
>();
/** Operator/test access only; never included in the unauthenticated health response. */
export const streamDiagnostics = (app: FastifyInstance) =>
  diagnostics.get(app)?.();
import {
  authority,
  transaction,
  fail,
  Wf2Error,
  type Actor,
} from "./participation-core.js";
export function cursor(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    fail("INVALID_INPUT", 400);
  return value;
}
export async function replay(
  pool: Pool,
  actor: Actor,
  world: string,
  after: string,
  limit = 100,
) {
  cursor(after);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    fail("INVALID_INPUT", 400);
  return transaction(pool, async (db) => {
    const b = await authority(db, world, actor);
    const w = (
      await db.query("SELECT public_cursor FROM founding_worlds WHERE id=$1", [
        world,
      ])
    ).rows[0]!;
    if (
      BigInt(after) < BigInt(b.replay_floor) ||
      BigInt(after) > BigInt(w.public_cursor)
    )
      throw new Wf2Error("RESET_REQUIRED", 409, true);
    const batches = (
      await db.query(
        "SELECT payload FROM wf2_shared_batches WHERE world_id=$1 AND cursor>$2 AND cursor<=$4 ORDER BY cursor LIMIT $3",
        [world, after, limit, w.public_cursor],
      )
    ).rows.map((r) => r.payload);
    if (batches.some((b) => !isWf2Batch(b)))
      throw new Wf2Error("RESET_REQUIRED", 409, true);
    return {
      batchSchema: "wf2-batch-1",
      fromCursor: after,
      toCursor: batches.at(-1)?.toCursor ?? after,
      headCursor: w.public_cursor,
      replayFloor: b.replay_floor,
      batches,
    };
  });
}
export async function pruneReplay(pool: Pool) {
  const worlds = (
    await pool.query("SELECT world_id FROM wf2_bindings ORDER BY world_id")
  ).rows;
  for (const { world_id: world } of worlds)
    await transaction(pool, async (db) => {
      await db.query(
        "SELECT world_id FROM wf2_bindings WHERE world_id=$1 FOR UPDATE",
        [world],
      );
      const floor = (
        await db.query(
          "SELECT greatest(b.replay_floor,w.public_cursor-10000,COALESCE((SELECT max(cursor) FROM wf2_shared_batches WHERE world_id=$1 AND committed_at<now()-interval '7 days'),0))::text AS n FROM wf2_bindings b JOIN founding_worlds w ON w.id=b.world_id WHERE b.world_id=$1",
          [world],
        )
      ).rows[0]!.n;
      await db.query(
        "DELETE FROM wf2_outbox WHERE world_id=$1 AND cursor<=$2",
        [world, floor],
      );
      await db.query(
        "DELETE FROM wf2_shared_batches WHERE world_id=$1 AND cursor<=$2",
        [world, floor],
      );
      await db.query(
        "UPDATE wf2_bindings SET replay_floor=$2 WHERE world_id=$1 AND replay_floor<$2",
        [world, floor],
      );
    });
  for (let batch = 0; batch < 10; batch++) {
    const pruned = await pool.query(
      "DELETE FROM wf2_operational_logs WHERE id IN(SELECT id FROM wf2_operational_logs WHERE at<now()-interval '14 days' ORDER BY at,id LIMIT 1000)",
    );
    if ((pruned.rowCount ?? 0) < 1000) break;
  }
  if (
    (
      await pool.query(
        "SELECT EXISTS(SELECT 1 FROM wf2_operational_logs WHERE at<now()-interval '14 days') AS overdue",
      )
    ).rows[0].overdue
  )
    throw Error("Operational retention cleanup backlog");
  await pool.query(
    "UPDATE wf2_invitations SET sealed_token=NULL WHERE expires_at<now() AND sealed_token IS NOT NULL",
  );
}
export function streamService(app: FastifyInstance, pool: Pool, auth: Wf2Auth) {
  type Stream = {
    world: string;
    rawCookie: string;
    actor: Actor;
    after: string;
    reply: FastifyReply;
    lastHeartbeat: number;
    busy: boolean;
  };
  const streams = new Set<Stream>();
  let maxBufferedBytes = 0,
    slowDisconnects = 0;
  diagnostics.set(app, () => ({
    activeStreams: streams.size,
    maxBufferedBytes,
    slowDisconnects,
  }));
  const sockets = new Set<Socket>();
  const deliveries = new Set<Promise<void>>(),
    opening = new Map<string, number>();
  let openingTotal = 0;
  let cleanupState: "pending" | "ok" | "warning" = "pending",
    lastCleanupSuccess = 0;
  let busy = false,
    closed = false,
    pending: Promise<void> = Promise.resolve(),
    lastCleanup = 0;
  const send = (s: Stream, event: string, value: unknown, id?: string) => {
    const text =
      (id ? "id: " + id + "\n" : "") +
      "event: " +
      event +
      "\ndata: " +
      JSON.stringify(value) +
      "\n\n";
    if (
      Buffer.byteLength(text) > 65536 ||
      s.reply.raw.writableLength + Buffer.byteLength(text) > 262144
    ) {
      s.reply.raw.destroy();
      streams.delete(s);
      return false;
    }
    const ok = s.reply.raw.write(text);
    maxBufferedBytes = Math.max(maxBufferedBytes, s.reply.raw.writableLength);
    if (!ok) {
      slowDisconnects++;
      s.reply.raw.destroy();
      streams.delete(s);
      return false;
    }
    return true;
  };
  function deliverTick() {
    // Each stream has its own flight. Slow provider validation never holds up
    // another session's revocation checks or delivery tick.
    for (const s of [...streams]) {
      if (s.busy) continue;
      s.busy = true;
      const flight = (async () => {
        try {
          const current = await auth.session(s.rawCookie);
          if (!current || current.session_hash !== s.actor.session_hash)
            fail("AUTH_REQUIRED", 403);
          const r = await replay(pool, current, s.world, s.after, 100);
          if (closed || !streams.has(s)) return;
          for (const b of r.batches) {
            if (!send(s, "batch", b, b.toCursor)) break;
            s.after = b.toCursor;
          }
          if (streams.has(s) && Date.now() - s.lastHeartbeat >= 10000) {
            s.reply.raw.write(": heartbeat\n\n");
            s.lastHeartbeat = Date.now();
          }
        } catch (e) {
          if (e instanceof Wf2Error && e.code === "RESET_REQUIRED")
            send(s, "reset", { reason: "RESET_REQUIRED" });
          else send(s, "reauth", {});
          s.reply.raw.end();
          streams.delete(s);
        } finally {
          s.busy = false;
        }
      })();
      deliveries.add(flight);
      void flight.finally(() => deliveries.delete(flight));
    }
  }
  async function poll() {
    if (busy || closed) return;
    busy = true;
    try {
      // Notification bookkeeping is never the source of replay or per-node delivery.
      if (streams.size)
        await pool.query(
          "UPDATE wf2_outbox SET state='notified' WHERE state='pending' AND (world_id,cursor) IN(SELECT world_id,cursor FROM wf2_outbox WHERE state='pending' ORDER BY next_attempt_at LIMIT 200)",
        );
      if (Date.now() - lastCleanup > 3600000) {
        lastCleanup = Date.now();
        await pruneReplay(pool);
        lastCleanupSuccess = Date.now();
        cleanupState = "ok";
      }
    } catch {
      cleanupState = "warning";
      console.error("WF2 replay/retention unavailable; durable state retained");
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    if (!closed) deliverTick();
    if (!busy && !closed) pending = poll();
  }, 250);
  timer.unref();
  app.addHook("preClose", async () => {
    closed = true;
    clearInterval(timer);
    for (const s of streams) s.reply.raw.end();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    streams.clear();
    await pending;
    await Promise.allSettled([...deliveries]);
  });
  return {
    health: () => ({
      retention: cleanupState,
      lastCleanupSuccess: lastCleanupSuccess
        ? new Date(lastCleanupSuccess).toISOString()
        : null,
    }),
    async open(
      req: FastifyRequest,
      reply: FastifyReply,
      world: string,
      after: string,
    ) {
      const a = await auth.session(req.cookies.cv_session);
      if (!a) fail("NOT_FOUND", 404);
      if (
        streams.size + openingTotal >= 16 ||
        [...streams].filter((s) => s.actor.session_hash === a.session_hash)
          .length +
          (opening.get(a.session_hash) ?? 0) >=
          4
      )
        fail("RATE_LIMITED", 429);
      openingTotal++;
      opening.set(a.session_hash, (opening.get(a.session_hash) ?? 0) + 1);
      try {
        await replay(pool, a, world, after, 1);
        if (closed) fail("TEMPORARY_UNAVAILABLE", 503);
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        });
        reply.raw.write(": connected\n\n");
        if (reply.raw.socket) {
          const socket = reply.raw.socket;
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
        }
        const s = {
          world,
          rawCookie: req.cookies.cv_session!,
          actor: a,
          after,
          reply,
          lastHeartbeat: Date.now(),
          busy: false,
        };
        streams.add(s);
        reply.raw.on("close", () => streams.delete(s));
      } finally {
        openingTotal--;
        opening.set(a.session_hash, (opening.get(a.session_hash) ?? 1) - 1);
      }
    },
  };
}
