import type { Pool } from "pg";
import { readFounding, readChunks } from "./founding.js";
import { planResidentGoals } from "@creators-village/world/living";

/** Read only, coherent topology and private access; never creates NPC/person rows. */
export async function readLivingVillage(
  pool: Pool,
  id: string,
  personId?: string,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let viewer = personId;
    if (!id.startsWith("showcase-")) {
      const binding = (
        await db.query(
          "SELECT creator_id,enabled FROM wf2_bindings WHERE world_id=$1",
          [id],
        )
      ).rows[0];
      if (binding) {
        if (!binding.enabled) {
          await db.query("ROLLBACK");
          return null;
        }
        if (binding.creator_id !== personId) {
          if (
            !personId ||
            !binding.enabled ||
            !(
              await db.query(
                "SELECT 1 FROM wf2_world_grants g JOIN wf2_memberships m ON m.community_id=g.community_id AND m.person_id=g.person_id WHERE g.world_id=$1 AND g.person_id=$2 AND g.can_view AND m.state='active'",
                [id, personId],
              )
            ).rowCount
          ) {
            await db.query("ROLLBACK");
            return null;
          }
        }
        viewer = binding.creator_id;
      }
    }
    const world = await readFounding(db, id, viewer);
    if (!world) {
      await db.query("ROLLBACK");
      return null;
    }
    const keys: string[] = [];
    for (let y = -2; y <= 1; y++)
      for (let x = -2; x <= 1; x++) keys.push(`${x},${y}`);
    const chunks = await readChunks(db, world, keys);
    const structures = id.startsWith("showcase-")
      ? []
      : (
          await db.query(
            "SELECT * FROM founding_structures WHERE world_id=$1 ORDER BY id",
            [id],
          )
        ).rows;
    const claims = id.startsWith("showcase-")
      ? []
      : (
          await db.query(
            "SELECT hx,hy FROM founding_occupancy WHERE world_id=$1 UNION SELECT hx,hy FROM wf2_claims WHERE world_id=$1",
            [id],
          )
        ).rows;
    const solids = [
      world.structure,
      ...structures.map((s) => ({
        x: s.qx / 256,
        y: s.qy / 256,
        width: s.width / 256,
        depth: s.depth / 256,
      })),
      ...claims.map((c) => ({
        x: c.hx / 2,
        y: c.hy / 2,
        width: 0.5,
        depth: 0.5,
      })),
    ];
    const places = [
      {
        id: world.structure.id,
        template: world.structure.template,
        entrance: world.structure.entrance,
      },
      ...structures
        .filter((s) => s.id !== world.structure.id)
        .map((s) => ({
          id: s.id,
          template: s.template,
          entrance: { x: s.entrance_qx / 256, y: s.entrance_qy / 256 },
        })),
    ];
    const time = Number(
      (
        await db.query(
          "SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now",
        )
      ).rows[0].now,
    );
    const plan = planResidentGoals(world, chunks, solids, places, time);
    await db.query("COMMIT");
    return plan;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
