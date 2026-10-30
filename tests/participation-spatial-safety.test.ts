import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "../apps/server/src/database.js";
import { publishFounding } from "../apps/server/src/founding.js";
import { planAt } from "../apps/server/src/participation-spatial.js";
import {
  baselineDigest,
  encodeChunk,
  generateBaseline,
  digest,
} from "../packages/world/src/founding.js";
import {
  terrainReader,
  walkGrid,
  reachable,
} from "../packages/world/src/founding-spatial.js";
import type { FoundingBaseline } from "@creators-village/contracts";

process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf2_spatial_test";
const pool = createPool(url.toString()),
  world = randomUUID(),
  person = randomUUID();
let original: FoundingBaseline;
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_wf2_spatial_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await migrate(pool);
  await pool.query("TRUNCATE people,wf2_operational_logs CASCADE");
  await pool.query(
    "INSERT INTO people(id,twitch_subject,display_name) VALUES($1,$2,'Spatial fixture')",
    [person, randomUUID()],
  );
  const job = randomUUID(),
    lease = new Date(Date.now() + 30000).toISOString();
  await pool.query(
    "INSERT INTO founding_jobs(id,creator_id,command_id,request_hash,world_id,name,seed,purpose,status,lease_until) VALUES($1,$2,$3,$4,$5,'Synthetic spatial fixture','fern','active','working',$6)",
    [job, person, randomUUID(), digest("spatial fixture"), world, lease],
  );
  original = generateBaseline("fern");
  await publishFounding(pool, job, original, lease);
}, 30000);
afterAll(async () => {
  await pool.end();
  await admin.end();
});

// These are deliberately adversarial, isolated saved geography fixtures. Every
// altered chunk/manifest is pinned consistently in one rolled-back transaction.
// Never amend a production baseline to make placement pass.
async function withTerrain(
  change: (b: FoundingBaseline) => void,
  run: (db: any, b: FoundingBaseline) => Promise<void>,
) {
  const db = await pool.connect(),
    b = structuredClone(original);
  change(b);
  for (const c of b.chunks) c.hash = digest(encodeChunk(c));
  b.hash = baselineDigest(b);
  try {
    await db.query("BEGIN");
    for (const c of b.chunks)
      await db.query(
        "UPDATE founding_chunks SET bytes=$4,hash=$5 WHERE world_id=$1 AND x=$2 AND y=$3",
        [world, c.x, c.y, encodeChunk(c), c.hash],
      );
    await db.query(
      "UPDATE founding_worlds SET header=jsonb_set(header,'{baseline,hash}',to_jsonb($2::text)),baseline_hash=$2 WHERE id=$1",
      [world, b.hash],
    );
    await run(db, b);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}
function cell(b: FoundingBaseline, x: number, y: number, value: number) {
  const cx = Math.floor(x / 32),
    cy = Math.floor(y / 32),
    c = b.chunks.find((c) => c.x === cx && c.y === cy)!;
  c.cells[(y - cy * 32) * 32 + x - cx * 32] = value;
}
function flat(b: FoundingBaseline) {
  for (const c of b.chunks) {
    c.heights.fill(32);
    c.cells.fill(0);
  }
}

it("D02/D05: wet/tree/rock/steep/nonflat support rejected; route detours around a real obstacle with full swept width", async () => {
  for (const flag of [1, 2, 4])
    await withTerrain(
      (b) => {
        flat(b);
        cell(b, -7, 0, flag);
      },
      async (db) => {
        await expect(planAt(db, world, -1792, 0)).rejects.toMatchObject({
          code: "INVALID_INPUT",
        });
      },
    );
  for (const delta of [1, 8])
    await withTerrain(
      (b) => {
        flat(b);
        const c = b.chunks.find((c) => c.x === -1 && c.y === 0)!;
        c.heights[25] = 32 + delta;
      },
      async (db) => {
        await expect(planAt(db, world, -1792, 0)).rejects.toMatchObject({
          code: "INVALID_INPUT",
        });
      },
    );
  await withTerrain(flat, async (db, b) => {
    const clear = await planAt(db, world, -1792, 0);
    expect(clear.path_points).toEqual(
      (await planAt(db, world, -1792, 0)).path_points,
    );
    // Place a tree directly on the initial route, beyond the building apron.
    const first = clear.path_points[0]!,
      next = clear.path_points[1]!;
    const obstacle = {
      qx: (first.qx + next.qx) / 2,
      qy: (first.qy + next.qy) / 2,
    };
    const bx = Math.floor(obstacle.qx / 256),
      by = Math.floor(obstacle.qy / 256);
    cell(b, bx, by, 2);
    for (const c of b.chunks) c.hash = digest(encodeChunk(c));
    b.hash = baselineDigest(b);
    const c = b.chunks.find(
      (c) => c.x === Math.floor(bx / 32) && c.y === Math.floor(by / 32),
    )!;
    await db.query(
      "UPDATE founding_chunks SET bytes=$4,hash=$5 WHERE world_id=$1 AND x=$2 AND y=$3",
      [world, c.x, c.y, encodeChunk(c), c.hash],
    );
    await db.query(
      "UPDATE founding_worlds SET header=jsonb_set(header,'{baseline,hash}',to_jsonb($2::text)),baseline_hash=$2 WHERE id=$1",
      [world, b.hash],
    );
    const detour = await planAt(db, world, -1792, 0),
      read = terrainReader(b, b.chunks);
    expect(detour.path_points).not.toEqual(clear.path_points);
    for (let i = 1; i < detour.path_points.length; i++) {
      const a = detour.path_points[i - 1]!,
        z = detour.path_points[i]!;
      expect(a.qx === z.qx || a.qy === z.qy).toBe(true);
      const n = Math.max(Math.abs(z.qx - a.qx), Math.abs(z.qy - a.qy)) / 64;
      for (let t = 0; t <= n; t++)
        for (const side of [-0.74, 0, 0.74]) {
          const x =
              (a.qx + ((z.qx - a.qx) * t) / n) / 256 +
              (a.qx === z.qx ? side : 0),
            y =
              (a.qy + ((z.qy - a.qy) * t) / n) / 256 +
              (a.qy === z.qy ? side : 0);
          expect(read.cell(x, y) & 7).toBe(0);
        }
    }
  });
}, 20000);

it("D05/D09: no bridge/route is invented; an otherwise supported footprint cannot cut off expansion access", async () => {
  await withTerrain(
    (b) => {
      flat(b);
      for (let y = 3; y <= 5; y++)
        for (let x = -32; x < 32; x++) cell(b, x, y, 1);
    },
    async (db) => {
      await expect(planAt(db, world, -1792, 0)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    },
  );
  await withTerrain(
    (b) => {
      flat(b);
      for (let y = -32; y < 32; y++)
        for (let x = -32; x < 32; x++) {
          const open =
            (x >= -10 && x < -4 && y >= -28 && y < 12) ||
            (y >= -1 && y < 2 && x >= -28 && x < 0) ||
            (y >= -28 && y < -22 && x >= -10 && x < 3) ||
            (x >= -3 && x < 3 && y >= 3 && y < 12) ||
            (y >= 8 && y < 12 && x >= -10 && x < 3);
          cell(b, x, y, open ? 0 : 4);
        }
    },
    async (db, b) => {
      const header = (
        await db.query("SELECT header FROM founding_worlds WHERE id=$1", [
          world,
        ])
      ).rows[0].header;
      const goals = [
        { x: -25, y: 0 },
        { x: 0, y: -25 },
      ];
      expect(
        reachable(walkGrid(b, b.chunks, header.active), { x: 0, y: 9 }, goals),
      ).toBe(true);
      expect(
        reachable(
          walkGrid(b, b.chunks, header.active, [
            { x: -10, y: -3, width: 6, depth: 6 },
          ]),
          { x: 0, y: 9 },
          goals,
        ),
      ).toBe(false);
      await expect(planAt(db, world, -1792, 0)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    },
  );
}, 20000);
