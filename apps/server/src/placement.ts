import type { Pool } from "pg";
import type { PlacementCheck } from "@creators-village/contracts";
import {
  authority,
  transaction,
  Wf2Error,
  type Actor,
} from "./participation-core.js";
import { planAt } from "./participation-spatial.js";
/** Advisory, non-reserving creator check. Creation and publication still run planAt independently. */
export function checkPlacement(
  pool: Pool,
  actor: Actor,
  world: string,
  site: { qx: number; qy: number },
  fundingModel?: "community-orbs-1",
): Promise<PlacementCheck> {
  return transaction(
    pool,
    async (db) => {
      await authority(db, world, actor, false, true);
      try {
        const p = await planAt(
          db,
          world,
          site.qx,
          site.qy,
          undefined,
          fundingModel,
        );
        const w = (
          await db.query(
            "SELECT topology_epoch FROM founding_worlds WHERE id=$1",
            [world],
          )
        ).rows[0]!;
        return {
          version: "cv-placement-1",
          valid: true,
          topologyEpoch: w.topology_epoch,
          site: {
            qx: p.qx,
            qy: p.qy,
            baseHeight: p.base_height,
            widthQ: 1536,
            depthQ: 1536,
          },
          path: { points: p.path_points, widthQ: p.path_width_q },
          ...("path_extension" in p && p.path_extension
            ? {
                extension: { points: p.path_extension, widthQ: p.path_width_q },
              }
            : {}),
        };
      } catch (e) {
        if (
          e instanceof Wf2Error &&
          ["INVALID_INPUT", "PLAN_CHANGED"].includes(e.code)
        )
          return {
            version: "cv-placement-1",
            valid: false,
            reason:
              "Choose clear, level ground with room for the entrance and a connecting path.",
          };
        throw e;
      }
    },
    "REPEATABLE READ",
  );
}
