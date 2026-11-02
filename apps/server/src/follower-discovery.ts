import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { readFoundingWorld } from "@creators-village/world/founding";
import type { Config } from "./config.js";
import { decrypt, encrypt, hash } from "./security.js";
import type { Session } from "./session-validation.js";
import {
  FOLLOW_SCOPE,
  ProviderError,
  type Tokens,
  type TwitchGateway,
} from "./twitch.js";
import {
  authority,
  fail,
  memberLimit,
  transaction,
  Wf2Error,
} from "./participation-core.js";

/** Cache rows older than this are not shown (the viewer must refresh). */
const MATCH_TTL = "24 hours";
const REFRESH_COOLDOWN = "60 seconds";
const MAX_MEMBER_LIMIT = 5000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FollowVillage = {
  worldId: string;
  name: string;
  creatorDisplayName: string;
  followersCanContribute: boolean;
};
export type FollowDiscovery = {
  status: "not-connected" | "connected";
  requiredScope: typeof FOLLOW_SCOPE;
  /** False when the feature is off: clients keep the R1 "not connected yet" copy. */
  available?: boolean;
  villages?: FollowVillage[];
  syncedAt?: string | null;
  refreshAvailableAt?: string | null;
};

export function hasFollowScope(s: Pick<Session, "granted_scopes">) {
  return (s.granted_scopes ?? []).includes(FOLLOW_SCOPE);
}

/** The viewer's cached discoverable villages; never the viewer's full followed list. */
export async function followDiscoveryView(
  pool: Pool,
  config: Config,
  s: Session,
): Promise<FollowDiscovery> {
  const base = { requiredScope: FOLLOW_SCOPE } as const;
  if (!config.followerDiscovery) return { status: "not-connected", ...base };
  if (!hasFollowScope(s))
    return { status: "not-connected", ...base, available: true };
  const [matches, sync] = await Promise.all([
    pool.query<{
      id: string;
      header: unknown;
      creator: string;
      contribute: boolean;
    }>(
      `SELECT b.world_id AS id,w.header,c.display_name AS creator,st.follower_can_contribute AS contribute
         FROM wf2_follow_matches fm
         JOIN wf2_bindings b ON b.community_id=fm.community_id AND b.enabled
         JOIN wf2_community_settings st ON st.community_id=fm.community_id AND st.follower_join_enabled
         JOIN founding_worlds w ON w.id=b.world_id
         JOIN people c ON c.id=b.creator_id
        WHERE fm.person_id=$1 AND b.creator_id<>$1
          AND fm.verified_at>now()-interval '${MATCH_TTL}'
          AND NOT EXISTS(SELECT 1 FROM wf2_memberships m
                          WHERE m.community_id=fm.community_id AND m.person_id=$1
                            AND m.state IN('active','banned','rejected'))
        ORDER BY c.display_name,b.world_id LIMIT 50`,
      [s.person_id],
    ),
    pool.query<{ synced_at: Date | null; next_allowed_at: Date }>(
      "SELECT synced_at,next_allowed_at FROM wf2_follow_sync WHERE person_id=$1",
      [s.person_id],
    ),
  ]);
  const villages: FollowVillage[] = [];
  for (const row of matches.rows) {
    let name: string;
    try {
      name = readFoundingWorld(row.header).name;
    } catch {
      continue;
    }
    villages.push({
      worldId: row.id,
      name,
      creatorDisplayName: row.creator,
      followersCanContribute: row.contribute,
    });
  }
  const meta = sync.rows[0];
  return {
    status: "connected",
    ...base,
    available: true,
    villages,
    syncedAt: meta?.synced_at?.toISOString() ?? null,
    refreshAvailableAt: meta?.next_allowed_at?.toISOString() ?? null,
  };
}

/** Second, optional authorization. Replaces only the *current* session's tokens. */
export async function upgradeFollowScope(
  pool: Pool,
  provider: TwitchGateway,
  config: Config,
  sessionHash: string,
  code: string,
): Promise<"ok" | "mismatch"> {
  const row = (
    await pool.query<{ person_id: string; twitch_subject: string }>(
      "SELECT s.person_id,p.twitch_subject FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.session_hash=$1 AND s.expires_at>now()",
      [sessionHash],
    )
  ).rows[0];
  if (!row) return "mismatch";
  const tokens = await provider.exchange(code);
  const identity = await provider.validate(tokens.access_token);
  // Same Twitch account, and the scope was actually granted (the user may deselect it).
  if (
    identity.subject !== row.twitch_subject ||
    !identity.scopes?.includes(FOLLOW_SCOPE)
  )
    return "mismatch";
  const saved = await pool.query(
    "UPDATE sessions SET encrypted_tokens=$1,token_expires_at=$2,granted_scopes=$3,validated_at=now() WHERE session_hash=$4 AND person_id=$5 AND expires_at>now()",
    [
      encrypt(tokens, config.encryptionKey),
      new Date(Date.now() + tokens.expires_in * 1000),
      [FOLLOW_SCOPE],
      sessionHash,
      row.person_id,
    ],
  );
  return saved.rowCount ? "ok" : "mismatch";
}

type Auth = {
  session: (raw: string | undefined) => Promise<Session | null>;
  mutation: (req: FastifyRequest) => Promise<Session | null>;
};
const send = (reply: FastifyReply, status: number, code: string, extra = {}) =>
  reply.code(status).send({ error: { code, ...extra } });
const record = (body: unknown): Record<string, unknown> | null =>
  body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;

export async function registerFollowerDiscovery(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  provider: TwitchGateway,
  auth: Auth,
) {
  const enabled = () =>
    Boolean(
      config.followerDiscovery &&
      provider.followedBroadcasters &&
      provider.isFollowing,
    );
  function accessToken(s: Session) {
    return decrypt<Tokens>(s.encrypted_tokens, config.encryptionKey)
      .access_token;
  }
  async function dropScope(s: Session) {
    await pool.query(
      "UPDATE sessions SET granted_scopes='{}' WHERE session_hash=$1",
      [s.session_hash],
    );
  }
  function wrap(
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
      try {
        return await handler(req, reply);
      } catch (e) {
        if (e instanceof Wf2Error)
          return send(reply, e.status, e.code, { retryable: e.retryable });
        if (e instanceof ProviderError) {
          if ([400, 401, 403].includes(e.status))
            return send(reply, 403, "RECONNECT_REQUIRED");
          return send(reply, 503, "PROVIDER_UNAVAILABLE", { retryable: true });
        }
        throw e;
      }
    };
  }

  app.get(
    "/auth/twitch/follows",
    wrap(async (req, reply) => {
      const raw = req.cookies.cv_session;
      const s = await auth.session(raw);
      if (!enabled() || !s || !raw) return send(reply, 404, "NOT_FOUND");
      const state = randomUUID() + randomUUID();
      await pool.query("DELETE FROM oauth_states WHERE expires_at<now()");
      await pool.query(
        "INSERT INTO oauth_states(state_hash,expires_at,purpose,session_hash) VALUES($1,now()+interval '10 minutes','follows',$2)",
        [hash(state), s.session_hash],
      );
      reply.setCookie("cv_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        path: "/",
        maxAge: 600,
      });
      const url = new URL("https://id.twitch.tv/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: FOLLOW_SCOPE,
        state,
      }).toString();
      return reply.redirect(url.toString());
    }),
  );

  app.post(
    "/api/communities/follows/refresh",
    wrap(async (req, reply) => {
      const s = await auth.mutation(req);
      if (!s) return send(reply, 403, "AUTH_REQUIRED");
      if (!enabled()) return send(reply, 404, "NOT_FOUND");
      if (!hasFollowScope(s)) return send(reply, 403, "RECONNECT_REQUIRED");
      const claim = await pool.query(
        `INSERT INTO wf2_follow_sync(person_id,next_allowed_at) VALUES($1,now()+interval '${REFRESH_COOLDOWN}')
         ON CONFLICT(person_id) DO UPDATE SET next_allowed_at=now()+interval '${REFRESH_COOLDOWN}'
         WHERE wf2_follow_sync.next_allowed_at<=now() RETURNING person_id`,
        [s.person_id],
      );
      if (!claim.rowCount) {
        const wait = (
          await pool.query<{ next_allowed_at: Date }>(
            "SELECT next_allowed_at FROM wf2_follow_sync WHERE person_id=$1",
            [s.person_id],
          )
        ).rows[0];
        reply.header(
          "Retry-After",
          String(
            Math.max(
              1,
              Math.ceil(
                ((wait?.next_allowed_at.getTime() ?? 0) - Date.now()) / 1000,
              ),
            ),
          ),
        );
        return send(reply, 429, "REFRESH_TOO_SOON", {
          retryAfter: wait?.next_allowed_at.toISOString() ?? null,
        });
      }
      let ids: string[];
      try {
        ids = await provider.followedBroadcasters!(
          accessToken(s),
          s.twitch_subject,
        );
      } catch (e) {
        if (e instanceof ProviderError && [400, 401, 403].includes(e.status))
          await dropScope(s);
        throw e;
      }
      await transaction(pool, async (db) => {
        await db.query("DELETE FROM wf2_follow_matches WHERE person_id=$1", [
          s.person_id,
        ]);
        // Only communities that opted in are ever stored; the full list is discarded here.
        await db.query(
          `INSERT INTO wf2_follow_matches(person_id,community_id,verified_at)
           SELECT $1,c.id,now() FROM wf2_communities c
             JOIN people p ON p.id=c.creator_id
             JOIN wf2_bindings b ON b.community_id=c.id AND b.enabled
             JOIN wf2_community_settings st ON st.community_id=c.id AND st.follower_join_enabled
            WHERE p.twitch_subject=ANY($2::text[]) AND p.id<>$1`,
          [s.person_id, ids],
        );
        await db.query(
          "UPDATE wf2_follow_sync SET synced_at=now() WHERE person_id=$1",
          [s.person_id],
        );
      });
      return followDiscoveryView(pool, config, s);
    }),
  );

  app.post(
    "/api/communities/follows/disconnect",
    wrap(async (req, reply) => {
      const s = await auth.mutation(req);
      if (!s) return send(reply, 403, "AUTH_REQUIRED");
      // Discovery data only. Memberships, grants, contributions and ledgers are untouched.
      await pool.query("DELETE FROM wf2_follow_matches WHERE person_id=$1", [
        s.person_id,
      ]);
      await dropScope(s);
      return { status: "not-connected", requiredScope: FOLLOW_SCOPE };
    }),
  );

  app.post(
    "/api/communities/follows/join",
    wrap(async (req, reply) => {
      const s = await auth.mutation(req);
      if (!s) return send(reply, 403, "AUTH_REQUIRED");
      if (!enabled() || config.writesPaused)
        return send(reply, 404, "NOT_FOUND");
      const body = record(req.body);
      const world =
        typeof body?.worldId === "string" ? body.worldId.toLowerCase() : "";
      if (!uuid.test(world)) return send(reply, 400, "INVALID_INPUT");
      if (!hasFollowScope(s)) return send(reply, 403, "RECONNECT_REQUIRED");
      const target = (
        await pool.query<{ community_id: string; subject: string }>(
          `SELECT b.community_id,p.twitch_subject AS subject
             FROM wf2_bindings b JOIN people p ON p.id=b.creator_id
             JOIN wf2_community_settings st ON st.community_id=b.community_id AND st.follower_join_enabled
            WHERE b.world_id=$1 AND b.enabled AND b.creator_id<>$2`,
          [world, s.person_id],
        )
      ).rows[0];
      // Opaque for unknown, disabled or non-opted-in villages: no existence oracle.
      if (!target) return send(reply, 404, "NOT_FOUND");
      // Live relationship check outside the database transaction (no locks held on the network).
      let following: boolean;
      try {
        following = await provider.isFollowing!(
          accessToken(s),
          s.twitch_subject,
          target.subject,
        );
      } catch (e) {
        if (e instanceof ProviderError && [400, 401, 403].includes(e.status))
          await dropScope(s);
        throw e;
      }
      if (!following) return send(reply, 403, "NOT_FOLLOWING");
      return transaction(pool, async (db) => {
        const b = (
          await db.query(
            "SELECT * FROM wf2_bindings WHERE world_id=$1 AND enabled FOR UPDATE",
            [world],
          )
        ).rows[0];
        const st = b
          ? (
              await db.query(
                "SELECT * FROM wf2_community_settings WHERE community_id=$1",
                [b.community_id],
              )
            ).rows[0]
          : undefined;
        if (!b || !st?.follower_join_enabled) fail("NOT_FOUND", 404);
        const session = await db.query(
          "SELECT 1 FROM sessions WHERE session_hash=$1 AND person_id=$2 AND expires_at>now() FOR SHARE",
          [s.session_hash, s.person_id],
        );
        if (!session.rowCount) fail("AUTH_REQUIRED", 403);
        const m = (
          await db.query(
            "SELECT * FROM wf2_memberships WHERE community_id=$1 AND person_id=$2 FOR UPDATE",
            [b.community_id, s.person_id],
          )
        ).rows[0];
        // A creator's ban or rejection stands; following does not override moderation.
        if (m && ["banned", "rejected"].includes(m.state))
          fail("FORBIDDEN", 403);
        if (m?.state === "active")
          return { worldId: world, state: "active", joined: false };
        const n = (
          await db.query(
            "SELECT count(*)::int AS n FROM wf2_memberships WHERE community_id=$1 AND state='active' AND person_id<>$2",
            [b.community_id, b.creator_id],
          )
        ).rows[0]!.n;
        if (n >= (await memberLimit(db, b))) fail("COMMUNITY_FULL");
        await db.query(
          `INSERT INTO wf2_memberships(id,community_id,person_id,state,join_source) VALUES($1,$2,$3,'active','follower')
           ON CONFLICT(community_id,person_id) DO UPDATE
             SET state='active',join_source='follower',revision=wf2_memberships.revision+1,changed_at=now()`,
          [randomUUID(), b.community_id, s.person_id],
        );
        // Least privilege: view always; Orb contribution only if the creator allowed it. No management rights.
        await db.query(
          `INSERT INTO wf2_world_grants(world_id,community_id,person_id,can_view,can_contribute)
           VALUES($1,$2,$3,true,$4)
           ON CONFLICT(world_id,person_id) DO UPDATE
             SET can_view=true,can_contribute=$4,can_create_projects=false,can_manage_construction=false,
                 can_moderate=false,revoked_at=NULL,revision=wf2_world_grants.revision+1`,
          [world, b.community_id, s.person_id, st.follower_can_contribute],
        );
        // A pending invitation request is superseded by active membership.
        await db.query(
          "UPDATE wf2_join_requests SET state='withdrawn',revision=revision+1,decided_at=now() WHERE world_id=$1 AND person_id=$2 AND state='pending'",
          [world, s.person_id],
        );
        await db.query(
          "DELETE FROM wf2_follow_matches WHERE person_id=$1 AND community_id=$2",
          [s.person_id, b.community_id],
        );
        await db.query(
          "UPDATE wf2_bindings SET authority_epoch=authority_epoch+1 WHERE world_id=$1",
          [world],
        );
        return { worldId: world, state: "active", joined: true };
      });
    }),
  );

  async function creatorContext(
    req: FastifyRequest,
    mutate: boolean,
    exclusive: boolean,
  ) {
    const s = mutate
      ? await auth.mutation(req)
      : await auth.session(req.cookies.cv_session);
    if (!s) fail(mutate ? "AUTH_REQUIRED" : "NOT_FOUND", mutate ? 403 : 404);
    const world = String(
      (req.params as Record<string, string>).worldId ?? "",
    ).toLowerCase();
    if (!uuid.test(world)) fail("INVALID_INPUT", 400);
    return { s, world, exclusive };
  }
  const settingsView = async (
    db: Pick<import("pg").PoolClient, "query">,
    b: { community_id: string; ruleset_id: string },
  ) => {
    const st = (
      await db.query(
        "SELECT * FROM wf2_community_settings WHERE community_id=$1",
        [b.community_id],
      )
    ).rows[0];
    const legacy = (
      await db.query(
        "SELECT max_non_creator_members FROM wf2_rulesets WHERE id=$1",
        [b.ruleset_id],
      )
    ).rows[0]!.max_non_creator_members as number;
    const active = (
      await db.query(
        "SELECT count(*)::int AS n FROM wf2_memberships m JOIN wf2_communities c ON c.id=m.community_id WHERE m.community_id=$1 AND m.state='active' AND m.person_id<>c.creator_id",
        [b.community_id],
      )
    ).rows[0]!.n as number;
    return {
      followerJoinEnabled: Boolean(st?.follower_join_enabled),
      followerCanContribute: Boolean(st?.follower_can_contribute),
      memberLimit: (st?.member_limit as number | undefined) ?? legacy,
      legacyMemberLimit: legacy,
      limitIsLegacy: !st,
      maxMemberLimit: MAX_MEMBER_LIMIT,
      activeMembers: active,
      revision: String(st?.revision ?? 0),
      available: Boolean(config.followerDiscovery),
    };
  };
  app.get(
    "/api/worlds/:worldId/community-settings",
    wrap(async (req) => {
      const { s, world } = await creatorContext(req, false, false);
      return transaction(pool, async (db) => {
        const b = await authority(db, world, s, false, true);
        return settingsView(db, b);
      });
    }),
  );
  app.put(
    "/api/worlds/:worldId/community-settings",
    wrap(async (req) => {
      const { s, world } = await creatorContext(req, true, true);
      const body = record(req.body);
      const limit = body?.memberLimit;
      if (
        !body ||
        typeof body.followerJoinEnabled !== "boolean" ||
        typeof body.followerCanContribute !== "boolean" ||
        typeof limit !== "number" ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_MEMBER_LIMIT ||
        typeof body.expectedRevision !== "string" ||
        !/^[0-9]{1,15}$/.test(body.expectedRevision)
      )
        fail("INVALID_INPUT", 400);
      if (body.followerJoinEnabled && !config.followerDiscovery)
        fail("FEATURE_UNAVAILABLE", 409);
      return transaction(pool, async (db) => {
        const b = await authority(db, world, s, true, true);
        const cur = (
          await db.query(
            "SELECT revision FROM wf2_community_settings WHERE community_id=$1 FOR UPDATE",
            [b.community_id],
          )
        ).rows[0];
        if (String(cur?.revision ?? 0) !== body.expectedRevision)
          fail("STALE_TARGET");
        await db.query(
          `INSERT INTO wf2_community_settings(community_id,follower_join_enabled,follower_can_contribute,member_limit)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(community_id) DO UPDATE SET follower_join_enabled=$2,follower_can_contribute=$3,
             member_limit=$4,revision=wf2_community_settings.revision+1,updated_at=now()`,
          [
            b.community_id,
            body.followerJoinEnabled,
            body.followerCanContribute,
            limit,
          ],
        );
        // Turning joining off hides the village from discovery immediately; members keep access.
        if (!body.followerJoinEnabled)
          await db.query(
            "DELETE FROM wf2_follow_matches WHERE community_id=$1",
            [b.community_id],
          );
        return settingsView(db, b);
      });
    }),
  );

  const permissionColumns = {
    canContribute: "can_contribute",
    canCreateProjects: "can_create_projects",
    canManageConstruction: "can_manage_construction",
    canModerate: "can_moderate",
  } as const;
  async function member(
    db: import("pg").PoolClient,
    world: string,
    b: Record<string, any>,
    id: string,
  ) {
    if (!uuid.test(id)) fail("INVALID_INPUT", 400);
    const row = (
      await db.query(
        `SELECT m.id,m.revision,m.state,m.join_source,m.person_id,g.can_view,g.can_contribute,
                g.can_create_projects,g.can_manage_construction,g.can_moderate
           FROM wf2_memberships m LEFT JOIN wf2_world_grants g ON g.world_id=$1 AND g.person_id=m.person_id
          WHERE m.id=$2 AND m.community_id=$3 FOR UPDATE OF m`,
        [world, id.toLowerCase(), b.community_id],
      )
    ).rows[0];
    if (!row || row.person_id === b.creator_id) fail("NOT_FOUND", 404);
    return row;
  }
  const permissionView = (row: Record<string, any>) => ({
    memberId: row.id,
    revision: String(row.revision),
    state: row.state,
    joinSource: row.join_source,
    permissions: {
      canContribute: Boolean(row.can_contribute),
      canCreateProjects: Boolean(row.can_create_projects),
      canManageConstruction: Boolean(row.can_manage_construction),
      canModerate: Boolean(row.can_moderate),
    },
  });
  app.get(
    "/api/worlds/:worldId/members/:memberId/permissions",
    wrap(async (req) => {
      const { s, world } = await creatorContext(req, false, false);
      return transaction(pool, async (db) => {
        const b = await authority(db, world, s, false, true);
        return permissionView(
          await member(
            db,
            world,
            b,
            (req.params as Record<string, string>).memberId!,
          ),
        );
      });
    }),
  );
  app.put(
    "/api/worlds/:worldId/members/:memberId/permissions",
    wrap(async (req) => {
      const { s, world } = await creatorContext(req, true, true);
      const body = record(req.body);
      const perms = record(body?.permissions);
      if (
        !body ||
        !perms ||
        typeof body.expectedMembershipRevision !== "string" ||
        !/^[0-9]{1,15}$/.test(body.expectedMembershipRevision) ||
        Object.keys(perms).length !== 4 ||
        Object.keys(permissionColumns).some(
          (k) => typeof perms[k] !== "boolean",
        )
      )
        fail("INVALID_INPUT", 400);
      return transaction(pool, async (db) => {
        // Only the creator delegates; a moderator cannot grant or widen permissions.
        const b = await authority(db, world, s, true, true);
        const row = await member(
          db,
          world,
          b,
          (req.params as Record<string, string>).memberId!,
        );
        if (row.state !== "active" || !row.can_view) fail("STALE_TARGET");
        if (String(row.revision) !== body.expectedMembershipRevision)
          fail("STALE_TARGET");
        await db.query(
          `UPDATE wf2_world_grants SET can_contribute=$3,can_create_projects=$4,can_manage_construction=$5,
                  can_moderate=$6,revision=revision+1 WHERE world_id=$1 AND person_id=$2`,
          [
            world,
            row.person_id,
            perms.canContribute,
            perms.canCreateProjects,
            perms.canManageConstruction,
            perms.canModerate,
          ],
        );
        const next = (
          await db.query(
            "UPDATE wf2_memberships SET revision=revision+1,changed_at=now() WHERE id=$1 RETURNING revision",
            [row.id],
          )
        ).rows[0]!;
        await db.query(
          "UPDATE wf2_bindings SET authority_epoch=authority_epoch+1 WHERE world_id=$1",
          [world],
        );
        return permissionView({
          ...row,
          revision: next.revision,
          can_contribute: perms.canContribute,
          can_create_projects: perms.canCreateProjects,
          can_manage_construction: perms.canManageConstruction,
          can_moderate: perms.canModerate,
        });
      });
    }),
  );
}
