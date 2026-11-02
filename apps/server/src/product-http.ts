import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  CommunitiesSchema,
  WorldEntrySchema,
  type WorldEntry,
} from "@creators-village/contracts";
import { readFoundingWorld } from "@creators-village/world/founding";
import type { Config } from "./config.js";
import type { Session } from "./session-validation.js";
import { foundingFixture } from "./founding.js";
import { followDiscoveryView } from "./follower-discovery.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty = () => ({
  contribute: false,
  plan: false,
  admit: false,
  enable: false,
});
export async function productEntry(
  pool: Pool,
  config: Config,
  id: string,
  person?: string,
): Promise<WorldEntry | null> {
  if (id.startsWith("showcase-")) {
    const f = foundingFixture(id.slice(9));
    return f
      ? {
          id: f.header.id,
          name: f.header.name,
          version: 2,
          source: "showcase",
          purpose: "showcase",
          reader: "founding",
          isCreator: false,
          capabilities: empty(),
        }
      : null;
  }
  if (!uuid.test(id)) return null;
  const legacy = (
    await pool.query("SELECT id,name,creator_id FROM worlds WHERE id=$1", [id])
  ).rows[0];
  if (legacy)
    return {
      id: legacy.id,
      name: legacy.name,
      version: 1,
      source: "creator",
      purpose: "legacy",
      reader: "legacy",
      isCreator: legacy.creator_id === person,
      capabilities: empty(),
    };
  const row = (
    await pool.query(
      "SELECT w.id,w.header,w.creator_id,w.purpose,b.world_id AS bound,b.enabled,b.state_schema,m.state,g.can_view,g.can_contribute,g.can_create_projects,g.can_manage_construction,g.can_moderate FROM founding_worlds w LEFT JOIN wf2_bindings b ON b.world_id=w.id LEFT JOIN wf2_world_grants g ON g.world_id=w.id AND g.person_id=$2 LEFT JOIN wf2_memberships m ON m.community_id=g.community_id AND m.person_id=g.person_id WHERE w.id=$1",
      [id, person ?? null],
    )
  ).rows[0];
  if (!row) return null;
  const owner = row.creator_id === person;
  if (
    row.bound &&
    (!row.enabled ||
      row.state_schema !== "wf2-state-1" ||
      row.state !== "active" ||
      !row.can_view)
  )
    return null;
  if (!row.bound && row.purpose === "development" && !owner) return null;
  const header = readFoundingWorld(row.header),
    configured = config.wf2WorldId === row.id;
  return {
    id: row.id,
    name: header.name,
    version: 2,
    source: "creator",
    purpose: row.purpose,
    reader:
      row.bound || (row.purpose === "development" && owner)
        ? "participation"
        : "founding",
    isCreator: owner,
    capabilities: {
      contribute: Boolean(configured && row.bound && row.can_contribute),
      // Delegated permissions are separate from membership; the creator always holds all.
      plan: Boolean(
        configured &&
        row.bound &&
        (owner || row.can_create_projects || row.can_manage_construction),
      ),
      admit: Boolean(configured && row.bound && (owner || row.can_moderate)),
      enable: Boolean(
        configured && !row.bound && owner && row.purpose === "development",
      ),
    },
  };
}
export async function registerProduct(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  session: (raw: string | undefined) => Promise<Session | null>,
) {
  app.get<{ Params: { id: string } }>(
    "/api/worlds/:id/entry",
    { schema: { response: { 200: WorldEntrySchema } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const s = await session(req.cookies.cv_session),
        entry = await productEntry(
          pool,
          config,
          req.params.id.toLowerCase(),
          s?.person_id,
        );
      if (!entry)
        return reply.code(404).send({ error: { code: "WORLD_UNAVAILABLE" } });
      return entry;
    },
  );
  app.get<{ Querystring: { after?: string } }>(
    "/api/communities",
    { schema: { response: { 200: CommunitiesSchema } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const s = await session(req.cookies.cv_session);
      if (!s) return reply.code(401).send({ error: { code: "AUTH_REQUIRED" } });
      const after = req.query.after;
      if (after && !uuid.test(after))
        return reply.code(400).send({ error: { code: "INVALID_INPUT" } });
      const [owned, granted, jobs] = await Promise.all([
        pool.query(
          "SELECT id FROM worlds WHERE creator_id=$1 UNION ALL SELECT id FROM founding_worlds WHERE creator_id=$1",
          [s.person_id],
        ),
        pool.query(
          "SELECT g.world_id AS id FROM wf2_world_grants g JOIN wf2_memberships m USING(community_id,person_id) JOIN wf2_bindings b ON b.world_id=g.world_id WHERE g.person_id=$1 AND g.can_view AND m.state='active' AND b.enabled AND b.creator_id<>$1 AND ($2::uuid IS NULL OR g.world_id>$2::uuid) ORDER BY g.world_id LIMIT 21",
          [s.person_id, after ?? null],
        ),
        pool.query("SELECT id FROM founding_jobs WHERE creator_id=$1", [
          s.person_id,
        ]),
      ]);
      const own = (
        await Promise.all(
          owned.rows.map((r) => productEntry(pool, config, r.id, s.person_id)),
        )
      ).filter((r): r is WorldEntry => Boolean(r));
      const joined = (
        await Promise.all(
          granted.rows
            .slice(0, 20)
            .map((r) => productEntry(pool, config, r.id, s.person_id)),
        )
      ).filter((r): r is WorldEntry => Boolean(r));
      const hasLegacy = own.some((w) => w.version === 1),
        hasFounding = jobs.rowCount! > 0;
      const reason =
        config.wf2WorldId || config.production
          ? "private-playtest"
          : hasFounding
            ? "job-in-progress"
            : hasLegacy
              ? "available"
              : owned.rowCount
                ? "existing-world"
                : "available";
      // Enrich only this actor's already-authorized entries, never public entry
      // lookups or pending/rejected request history.
      const entries = [...own, ...joined];
      if (entries.length) {
        const names = await pool.query<{
          id: string;
          version: number;
          display_name: string;
        }>(
          "SELECT w.id,1 AS version,p.display_name FROM worlds w JOIN people p ON p.id=w.creator_id WHERE w.id=ANY($1::uuid[]) UNION ALL SELECT w.id,2 AS version,p.display_name FROM founding_worlds w JOIN people p ON p.id=w.creator_id WHERE w.id=ANY($2::uuid[])",
          [
            entries.filter((w) => w.version === 1).map((w) => w.id),
            entries.filter((w) => w.version === 2).map((w) => w.id),
          ],
        );
        const creators = new Map(
          names.rows.map((r) => [r.version + ":" + r.id, r.display_name]),
        );
        for (const entry of entries) {
          const name = creators.get(entry.version + ":" + entry.id);
          if (name !== undefined) entry.creatorDisplayName = name;
        }
      }
      return {
        own,
        joined,
        nextJoinedCursor:
          granted.rows.length > 20 ? granted.rows[19]!.id : null,
        followDiscovery: await followDiscoveryView(pool, config, s),
        creation: {
          allowed: reason === "available",
          development: hasLegacy,
          reason,
        },
      };
    },
  );
}
