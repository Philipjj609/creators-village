import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  generateBaseline,
  encodeChunk,
  decodeChunk,
  readFoundingWorld,
  worldHeader,
} from "@creators-village/world/founding";
import { halfClaims } from "@creators-village/world/spatial";
import type {
  FoundingBaseline,
  FoundingWorld,
} from "@creators-village/contracts";
import { hash } from "./security.js";
export async function withTopologyGuard<T>(
  pool: Pool,
  id: string,
  action: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '2s'");
    if (
      !(
        await db.query(
          "SELECT id FROM founding_worlds WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rowCount
    )
      throw Error("Unknown world");
    const result = await action(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function enqueueFounding(
  pool: Pool,
  person: string,
  sessionHash: string,
  input: {
    commandId: string;
    name: string;
    seed: string;
    development: boolean;
  },
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT session_hash FROM sessions WHERE session_hash=$1 AND person_id=$2 AND expires_at>now() FOR SHARE",
          [sessionHash, person],
        )
      ).rowCount
    )
      throw Error("session");
    await db.query("SELECT id FROM people WHERE id=$1 FOR UPDATE", [person]);
    const requestHash = hash(
      JSON.stringify({
        name: input.name.trim(),
        seed: input.seed.normalize("NFC"),
        development: input.development,
      }),
    );
    const old = (
      await db.query("SELECT * FROM founding_jobs WHERE creator_id=$1", [
        person,
      ])
    ).rows[0];
    if (old) {
      await db.query("COMMIT");
      if (
        old.command_id !== input.commandId ||
        old.request_hash !== requestHash
      )
        return { conflict: true };
      return { jobId: old.id, worldId: old.world_id };
    }
    const legacy = (
      await db.query("SELECT id FROM worlds WHERE creator_id=$1", [person])
    ).rows[0];
    if (Boolean(legacy) !== input.development) {
      await db.query("ROLLBACK");
      return { conflict: true };
    }
    const id = randomUUID(),
      worldId = randomUUID();
    await db.query(
      "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')",
      [
        id,
        person,
        input.commandId,
        requestHash,
        worldId,
        input.name.trim(),
        input.seed.normalize("NFC"),
        legacy ? "development" : "active",
      ],
    );
    await db.query("COMMIT");
    return { jobId: id, worldId };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function publishFounding(
  pool: Pool,
  jobId: string,
  baseline: FoundingBaseline,
  lease: string,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const job = (
      await db.query(
        "SELECT * FROM founding_jobs WHERE id=$1 AND status='working' AND lease_until=$2 FOR UPDATE",
        [jobId, lease],
      )
    ).rows[0];
    if (!job) {
      await db.query("ROLLBACK");
      return;
    }
    const header = worldHeader(baseline, {
        id: job.world_id,
        name: job.name,
        createdAt: job.created_at.toISOString(),
        source: "creator",
        purpose: job.purpose,
      }),
      s = header.structure;
    await db.query(
      "INSERT INTO founding_worlds(id,creator_id,job_id,format,purpose,header,baseline_hash) VALUES($1,$2,$3,2,$4,$5,$6)",
      [header.id, job.creator_id, job.id, job.purpose, header, baseline.hash],
    );
    for (const c of baseline.chunks)
      await db.query(
        "INSERT INTO founding_chunks(world_id,x,y,hash,encoding,bytes) VALUES($1,$2,$3,$4,'i16le-u8-32-v1',$5)",
        [header.id, c.x, c.y, c.hash, encodeChunk(c)],
      );
    await db.query(
      "INSERT INTO founding_structures(world_id,id,template,qx,qy,width,depth,height,entrance_qx,entrance_qy,appearance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        header.id,
        s.id,
        s.template,
        s.x * 256,
        s.y * 256,
        s.width * 256,
        s.depth * 256,
        s.height * 16,
        s.entrance.x * 256,
        s.entrance.y * 256,
        s.appearance,
      ],
    );
    for (const key of halfClaims(s)) {
      const [x, y] = key.split(",").map(Number);
      await db.query(
        "INSERT INTO founding_occupancy VALUES($1,'ground',$2,$3,$4)",
        [header.id, x, y, s.id],
      );
    }
    await db.query("INSERT INTO founding_paths VALUES($1,$2,$3,$4)", [
      header.id,
      header.path.id,
      header.path.width * 256,
      JSON.stringify(header.path.points),
    ]);
    await db.query(
      "INSERT INTO founding_public_events VALUES($1,1,'world.founded',$2)",
      [
        header.id,
        { worldId: header.id, baselineHash: baseline.hash, structureId: s.id },
      ],
    );
    await db.query(
      "UPDATE founding_jobs SET status='ready',lease_until=NULL WHERE id=$1",
      [job.id],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
function workerBaseline(seed: string): Promise<FoundingBaseline> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../dist/founding-worker.js", import.meta.url),
      { workerData: { seed } },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(Error("Generation timed out"));
    }, 10000);
    worker.once("message", (m) => {
      clearTimeout(timeout);
      void worker.terminate();
      m.baseline ? resolve(m.baseline) : reject(Error(m.error));
    });
    worker.once("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    worker.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(Error("Generation worker exited"));
    });
  });
}
export function foundingRunner(pool: Pool, enabled = true) {
  let busy = false,
    closed = false;
  let pending: Promise<void> = Promise.resolve();
  async function run() {
    if (busy || closed || !enabled) return;
    busy = true;
    try {
      const job = (
        await pool.query(
          "WITH next AS (SELECT id FROM founding_jobs WHERE origin='creator' AND (status='pending' OR (status='working' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE founding_jobs j SET status='working',lease_until=date_trunc('milliseconds',now()+interval '30 seconds'),error=NULL FROM next WHERE j.id=next.id RETURNING j.*",
        )
      ).rows[0];
      if (!job) return;
      try {
        const b = await workerBaseline(job.seed);
        await publishFounding(pool, job.id, b, job.lease_until.toISOString());
      } catch {
        await pool.query(
          "UPDATE founding_jobs SET status='failed',error='Founding generation failed safely',lease_until=NULL WHERE id=$1 AND lease_until=$2",
          [job.id, job.lease_until],
        );
      }
    } catch {
      console.error(
        "Founding worker database unavailable; pending jobs retained",
      );
    } finally {
      busy = false;
    }
  }
  const tick = () => {
    if (!busy && !closed) pending = run();
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return {
    wake: tick,
    async close() {
      closed = true;
      clearInterval(timer);
      await pending;
    },
  };
}
const fixtures = new Map<
  string,
  { header: FoundingWorld; baseline: FoundingBaseline }
>();
export function foundingFixture(seed: string) {
  if (!["fern", "willow", "hearth", "brook"].includes(seed)) return null;
  let f = fixtures.get(seed);
  if (!f) {
    const baseline = generateBaseline(seed);
    f = {
      baseline,
      header: worldHeader(baseline, {
        id: `showcase-${seed}`,
        name:
          seed === "fern"
            ? "Fern Beginning"
            : seed === "hearth"
              ? "Creek Beginning"
              : seed === "brook"
                ? "Ridge Clearing"
                : "Willow Beginning",
        createdAt: "2026-10-29T00:00:00.000Z",
        source: "showcase",
        purpose: "development",
      }),
    };
    fixtures.set(seed, f);
  }
  return f;
}
export async function readFounding(pool: Pool, id: string, personId?: string) {
  if (id.startsWith("showcase-"))
    return foundingFixture(id.slice(9))?.header ?? null;
  const row = (
    await pool.query(
      "SELECT f.header,f.purpose,f.creator_id,f.topology_epoch,f.public_cursor,s.id AS structure_id,s.template,s.qx,s.qy,s.width,s.depth,s.height,s.entrance_qx,s.entrance_qy,s.appearance,p.id AS path_id,p.width AS path_width,p.geometry FROM founding_worlds f JOIN founding_structures s ON s.world_id=f.id AND s.id='founding-shelter' JOIN founding_paths p ON p.world_id=f.id AND p.id='founding-path' WHERE f.id=$1",
      [id],
    )
  ).rows[0];
  if (!row || (row.purpose === "development" && row.creator_id !== personId))
    return null;
  const header = readFoundingWorld(row.header);
  if (
    row.template !== "gathering-shelter-1" ||
    row.appearance !== "hearthside-hero-01/commons"
  )
    throw Error("Unsupported spatial or appearance contract");
  return {
    ...header,
    publicCursor: row.public_cursor,
    topologyEpoch: row.topology_epoch,
    structure: {
      ...header.structure,
      id: row.structure_id,
      template: row.template,
      x: row.qx / 256,
      y: row.qy / 256,
      width: row.width / 256,
      depth: row.depth / 256,
      height: row.height / 16,
      entrance: { x: row.entrance_qx / 256, y: row.entrance_qy / 256 },
      appearance: row.appearance,
    },
    path: {
      id: row.path_id,
      width: row.path_width / 256,
      points: row.geometry,
    },
  };
}
export async function readChunks(
  pool: Pool,
  header: FoundingWorld,
  keys: string[],
) {
  const fixture =
    header.source === "showcase" ? foundingFixture(header.id.slice(9)) : null;
  if (fixture)
    return fixture.baseline.chunks.filter((c) =>
      keys.includes(`${c.x},${c.y}`),
    );
  const rows = await pool.query(
    "SELECT x,y,hash,bytes FROM founding_chunks WHERE world_id=$1 AND (x::text||','||y::text)=ANY($2::text[])",
    [header.id, keys],
  );
  return rows.rows.map((r) => decodeChunk(r.x, r.y, r.bytes, r.hash));
}
