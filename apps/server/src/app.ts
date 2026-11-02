import { validateSessionHash, type Session } from "./session-validation.js";
import { registerProduct } from "./product-http.js";
import {
  registerFollowerDiscovery,
  upgradeFollowScope,
} from "./follower-discovery.js";
import { readLivingVillage } from "./living.js";
import { registerProductionWeb } from "./production-web.js";
import Fastify from "fastify";
import { registerParticipation } from "./participation-http.js";
import {
  FoundingCreateSchema,
  FoundingIdSchema,
  FoundingJobIdSchema,
  FoundingKeysSchema,
} from "@creators-village/contracts";
import {
  enqueueFounding,
  foundingRunner,
  readFounding,
  readChunks,
} from "./founding.js";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  CreateVillageSchema,
  SnapshotSchema,
  type CreateVillageInput,
} from "@creators-village/contracts";
import { generateWorld, readCompatibleWorld } from "@creators-village/world";
import type { Config } from "./config.js";
import { repositoryRoot } from "./database.js";
import { encrypt, equal, hash, randomToken } from "./security.js";
import { type TwitchGateway } from "./twitch.js";

export async function buildApp(
  config: Config,
  pool: Pool,
  provider: TwitchGateway,
) {
  const app = Fastify({
    trustProxy: config.trustProxy === 1 ? (_address, hop) => hop === 0 : false,
    forceCloseConnections: true,
    logger: false,
    bodyLimit: 8192,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const runner = foundingRunner(pool, !config.writesPaused);
  app.addHook("onClose", async () => runner.close());
  app.addHook("onRequest", async (req, reply) => {
    if (
      config.writesPaused &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.url.startsWith("/api/") &&
      req.url.split("?")[0] !== "/api/logout"
    )
      return reply
        .code(503)
        .header("Retry-After", "60")
        .send({ error: "Gameplay temporarily paused for maintenance" });
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
      },
    },
  });
  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: "1 minute",
    allowList: (request) => request.url.startsWith("/assets/"),
  });
  const publicBudget = app.rateLimit({
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) => "public:" + req.ip,
  });
  const privateIpBudget = app.createRateLimit({
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => "wf2-ip:" + req.ip,
  });
  const privateAccountBudget = app.rateLimit({
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: async (req) => {
      const raw = req.cookies.cv_session;
      if (raw && /^[0-9a-f]{64}$/.test(raw)) {
        const s = (
          await pool.query(
            "SELECT person_id FROM sessions WHERE session_hash=$1 AND expires_at>now()",
            [hash(raw)],
          )
        ).rows[0];
        if (s) return "wf2-account:" + s.person_id;
      }
      return "wf2-anonymous:" + req.ip;
    },
  });
  app.addHook("onRequest", async (req, reply) => {
    if (
      req.url.startsWith("/assets/") ||
      ["/livez", "/readyz"].includes(req.url.split("?")[0]!)
    )
      return;
    if (req.url.startsWith("/api/wf2/")) {
      const budget = await privateIpBudget(req);
      if (!budget.isAllowed && budget.isExceeded) {
        reply.header("Retry-After", budget.ttlInSeconds);
        throw Object.assign(Error("Rate limit exceeded"), { statusCode: 429 });
      }
      await privateAccountBudget.call(app, req, reply);
    } else await publicBudget.call(app, req, reply);
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
    path: "/",
  };
  app.setErrorHandler((e, _req, reply) => {
    const safe = e as { name?: string; code?: string; status?: number };
    console.error(
      JSON.stringify({
        event: "request_failed",
        name: safe.name ?? "Error",
        code: safe.code ?? null,
        providerStatus: safe.status ?? null,
      }),
    );
    const status = (e as { statusCode?: number }).statusCode;
    const code = status && status >= 400 && status < 500 ? status : 503;
    reply.code(code).send({
      error:
        code === 503
          ? "Service temporarily unavailable. Please try again."
          : "Request could not be accepted.",
    });
  });
  const sessionFlights = new Map<string, Promise<Session | null>>();
  async function session(raw: string | undefined): Promise<Session | null> {
    if (!raw) return null;
    const pending = sessionFlights.get(raw);
    if (pending) return pending;
    const flight = loadSession(raw);
    sessionFlights.set(raw, flight);
    try {
      return await flight;
    } finally {
      sessionFlights.delete(raw);
    }
  }
  async function loadSession(raw: string | undefined): Promise<Session | null> {
    if (!raw || !/^[0-9a-f]{64}$/.test(raw)) return null;
    return validateSessionHash(pool, provider, config.encryptionKey, hash(raw));
  }
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", database: "connected", wf2: participation.health() };
  });
  await registerProduct(app, pool, config, session);
  app.get("/api/me", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const s = await session(req.cookies.cv_session);
    if (!s) return { person: null };
    const world = (
      await pool.query<{ id: string }>(
        "SELECT id FROM worlds WHERE creator_id=$1",
        [s.person_id],
      )
    ).rows[0];
    const founding = (
      await pool.query(
        "SELECT id, purpose FROM founding_worlds WHERE creator_id=$1",
        [s.person_id],
      )
    ).rows[0];
    return {
      person: {
        displayName: s.display_name,
        csrfToken: s.csrf_token,
        worldId:
          world?.id ?? (founding?.purpose === "active" ? founding.id : null),
        worldVersion: world ? 1 : founding?.purpose === "active" ? 2 : null,
        developmentWorldId:
          founding?.purpose === "development" ? founding.id : null,
      },
    };
  });
  app.get("/auth/twitch", async (req, reply) => {
    if (!config.clientId || !config.clientSecret)
      return reply
        .code(503)
        .send({ error: "Twitch configuration unavailable" });
    const state = randomToken();
    await pool.query("DELETE FROM oauth_states WHERE expires_at<now()");
    const join = req.cookies.cv_join
      ? (
          await pool.query(
            "SELECT id FROM wf2_join_continuations WHERE cookie_hash=$1 AND expires_at>now()",
            [hash(req.cookies.cv_join)],
          )
        ).rows[0]?.id
      : null;
    await pool.query(
      "INSERT INTO oauth_states(state_hash,expires_at,join_continuation_id) VALUES($1,now()+interval '10 minutes',$2)",
      [hash(state), join ?? null],
    );
    reply.setCookie("cv_oauth_state", state, { ...cookieOptions, maxAge: 600 });
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "",
      state,
    }).toString();
    reply.header("Cache-Control", "no-store");
    return reply.redirect(url.toString());
  });
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/twitch/callback",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const { state, code, error } = req.query;
      const saved = req.cookies.cv_oauth_state;
      reply.clearCookie("cv_oauth_state", cookieOptions);
      if (!state || !saved || !equal(state, saved))
        return reply.code(400).send({
          error: "Authentication state did not match. Please start again.",
        });
      const used = await pool.query(
        "DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash,join_continuation_id,purpose,session_hash",
        [hash(state)],
      );
      if (!used.rowCount)
        return reply.code(400).send({
          error: "Authentication request expired or was already used.",
        });
      if (used.rows[0].purpose === "follows") {
        // Optional second authorization: bound to the session that started it.
        const raw = req.cookies.cv_session;
        const back = config.webOrigin + "/communities";
        if (
          !config.followerDiscovery ||
          !raw ||
          hash(raw) !== used.rows[0].session_hash
        )
          return reply.redirect(back + "?follows=failed");
        if (error || !code) return reply.redirect(back + "?follows=declined");
        try {
          const outcome = await upgradeFollowScope(
            pool,
            provider,
            config,
            hash(raw),
            code,
          );
          return reply.redirect(
            back +
              (outcome === "ok" ? "?follows=connected" : "?follows=declined"),
          );
        } catch {
          return reply.redirect(back + "?follows=failed");
        }
      }
      if (error || !code)
        return reply.redirect(config.webOrigin + "/?auth=declined");
      const tokens = await provider.exchange(code),
        identity = await provider.validate(tokens.access_token);
      const person = (
        await pool.query<{ id: string }>(
          "INSERT INTO people(id,twitch_subject,display_name,twitch_login) VALUES($1,$2,$3,$4) ON CONFLICT(twitch_subject) DO UPDATE SET display_name=excluded.display_name,twitch_login=COALESCE(excluded.twitch_login,people.twitch_login) RETURNING id",
          [
            randomUUID(),
            identity.subject,
            identity.displayName,
            identity.login ?? null,
          ],
        )
      ).rows[0]!;
      const raw = randomToken();
      await pool.query(
        "INSERT INTO sessions(session_hash,person_id,csrf_token,encrypted_tokens,token_expires_at,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')",
        [
          hash(raw),
          person.id,
          randomToken(),
          encrypt(tokens, config.encryptionKey),
          new Date(Date.now() + tokens.expires_in * 1000),
        ],
      );
      reply.setCookie("cv_session", raw, { ...cookieOptions, maxAge: 86400 });
      return reply.redirect(
        config.webOrigin +
          (used.rows[0].join_continuation_id
            ? "/join?continuation=" +
              encodeURIComponent(used.rows[0].join_continuation_id)
            : "/communities"),
      );
    },
  );
  async function authorizeMutation(req: {
    headers: Record<string, unknown>;
    cookies: Record<string, string | undefined>;
  }) {
    if (req.headers.origin !== config.webOrigin) return null;
    const s = await session(req.cookies.cv_session);
    const csrf = req.headers["x-csrf-token"];
    return s && typeof csrf === "string" && equal(s.csrf_token, csrf)
      ? s
      : null;
  }
  app.post("/auth/logout", async (req, reply) => {
    const s = await authorizeMutation(req);
    if (!s)
      return reply.code(403).send({ error: "Sign in again to continue." });
    await pool.query("DELETE FROM sessions WHERE session_hash=$1", [
      s.session_hash,
    ]);
    reply.clearCookie("cv_session", cookieOptions);
    return { ok: true };
  });
  const participation = await registerParticipation(app, pool, config, {
    session,
    mutation: authorizeMutation,
  });
  await registerFollowerDiscovery(app, pool, config, provider, {
    session,
    mutation: authorizeMutation,
  });
  app.get<{ Params: { seed: string } }>(
    "/api/showcase/:seed",
    {
      schema: {
        params: {
          type: "object",
          properties: { seed: { type: "string", maxLength: 64 } },
          required: ["seed"],
        },
        response: { 200: SnapshotSchema },
      },
    },
    async (req) =>
      generateWorld(req.params.seed, {
        id: "showcase-" + hash(req.params.seed).slice(0, 10),
        name: req.params.seed === "willow" ? "Willowmere" : "Fern Hollow",
        createdAt: "2026-10-28T00:00:00Z",
        source: "showcase",
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/villages/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
        response: { 200: SnapshotSchema },
      },
    },
    async (req, reply) => {
      const row = (
        await pool.query<{ snapshot: unknown }>(
          "SELECT snapshot FROM worlds WHERE id=$1",
          [req.params.id],
        )
      ).rows[0];
      if (!row) return reply.code(404).send();
      reply.header("Cache-Control", "no-cache");
      return readCompatibleWorld(row.snapshot);
    },
  );
  app.post<{ Body: CreateVillageInput }>(
    "/api/villages",
    {
      schema: { body: CreateVillageSchema, response: { 200: SnapshotSchema } },
    },
    async (req, reply) => {
      const s = await authorizeMutation(req);
      if (!s)
        return reply
          .code(403)
          .send({ error: "Creator sign-in and a valid request are required." });
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const active = await db.query(
          "SELECT session_hash FROM sessions WHERE session_hash=$1 AND expires_at>now() FOR SHARE",
          [s.session_hash],
        );
        if (!active.rowCount) {
          await db.query("ROLLBACK");
          return reply.code(403).send({ error: "Sign in again to continue." });
        }
        await db.query("SELECT id FROM people WHERE id=$1 FOR UPDATE", [
          s.person_id,
        ]);
        const requestHash = hash(
          JSON.stringify({ name: req.body.name, seed: req.body.seed }),
        );
        const receipt = (
          await db.query<{ request_hash: string; snapshot: unknown }>(
            "SELECT r.request_hash,w.snapshot FROM create_receipts r JOIN worlds w ON w.id=r.world_id WHERE r.person_id=$1 AND r.command_id=$2",
            [s.person_id, req.body.commandId],
          )
        ).rows[0];
        if (receipt) {
          await db.query("COMMIT");
          if (receipt.request_hash !== requestHash)
            return reply.code(409).send({
              error: "Command ID already used with different content.",
            });
          return readCompatibleWorld(receipt.snapshot);
        }
        const existing = (
          await db.query("SELECT id FROM worlds WHERE creator_id=$1", [
            s.person_id,
          ])
        ).rows[0];
        const v2 = (
          await db.query("SELECT id FROM founding_jobs WHERE creator_id=$1", [
            s.person_id,
          ])
        ).rows[0];
        if (existing || v2) {
          await db.query("ROLLBACK");
          return reply.code(409).send({
            error: "This creator already has a village.",
            worldId: existing?.id ?? null,
          });
        }
        if (config.production) {
          await db.query("ROLLBACK");
          return reply
            .code(403)
            .send({ error: { code: "ONBOARDING_CLOSED", retryable: false } });
        }
        const snapshot = generateWorld(req.body.seed, {
          id: randomUUID(),
          name: req.body.name.trim(),
          createdAt: new Date().toISOString(),
          source: "creator",
        });
        await db.query(
          "INSERT INTO worlds(id,creator_id,name,seed,generator_version,asset_version,schema_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            snapshot.id,
            s.person_id,
            snapshot.name,
            snapshot.seed,
            snapshot.generatorVersion,
            snapshot.assetVersion,
            snapshot.schemaVersion,
            JSON.stringify(snapshot),
          ],
        );
        await db.query(
          "INSERT INTO create_receipts(person_id,command_id,request_hash,world_id) VALUES($1,$2,$3,$4)",
          [s.person_id, req.body.commandId, requestHash, snapshot.id],
        );
        await db.query(
          "INSERT INTO world_events(world_id,sequence,kind) VALUES($1,1,'world.created')",
          [snapshot.id],
        );
        await db.query("COMMIT");
        return snapshot;
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
    },
  );
  const IdParams = FoundingIdSchema;
  app.get<{ Params: { id: string } }>(
    "/api/founding/:id/residents",
    { schema: { params: IdParams } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const who = await session(req.cookies.cv_session);
      const plan = await readLivingVillage(pool, req.params.id, who?.person_id);
      return plan ?? reply.code(404).send({ error: "World unavailable" });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/founding/:id",
    { schema: { params: IdParams } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const who = await session(req.cookies.cv_session);
      if (who && !req.params.id.startsWith("showcase-")) {
        const scoped = (
          await pool.query(
            "SELECT b.world_id FROM wf2_bindings b LEFT JOIN wf2_world_grants g ON g.world_id=b.world_id AND g.person_id=$2 LEFT JOIN wf2_memberships m ON m.community_id=g.community_id AND m.person_id=g.person_id WHERE b.world_id=$1 AND (b.creator_id=$2 OR (b.enabled AND g.can_view AND m.state='active'))",
            [req.params.id, who.person_id],
          )
        ).rowCount;
        if (scoped)
          return reply.code(409).send({
            error: { code: "CLIENT_UPDATE_REQUIRED", retryable: false },
          });
      }
      const header = await readFounding(pool, req.params.id, who?.person_id);
      if (!header) return reply.code(404).send({ error: "World unavailable" });
      if (
        !req.params.id.startsWith("showcase-") &&
        (
          await pool.query(
            "SELECT world_id FROM wf2_bindings WHERE world_id=$1",
            [req.params.id],
          )
        ).rowCount
      )
        return reply.code(409).send({
          error: { code: "CLIENT_UPDATE_REQUIRED", retryable: false },
        });
      return header;
    },
  );
  app.get<{ Params: { id: string }; Querystring: { keys: string } }>(
    "/api/founding/:id/chunks",
    { schema: { params: IdParams, querystring: FoundingKeysSchema } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const who = await session(req.cookies.cv_session);
      let viewer = who?.person_id;
      if (who && !req.params.id.startsWith("showcase-")) {
        const grant = (
          await pool.query(
            "SELECT b.creator_id FROM wf2_bindings b JOIN wf2_world_grants g ON g.world_id=b.world_id JOIN wf2_memberships m ON m.community_id=g.community_id AND m.person_id=g.person_id WHERE b.world_id=$1 AND g.person_id=$2 AND b.enabled AND g.can_view AND m.state='active'",
            [req.params.id, who.person_id],
          )
        ).rows[0];
        if (grant) viewer = grant.creator_id;
      }
      const header = await readFounding(pool, req.params.id, viewer);
      if (!header) return reply.code(404).send({ error: "World unavailable" });
      const keys = [...new Set(req.query.keys.split(";"))];
      if (
        keys.length > 64 ||
        keys.some((k) => !/^(-?[0-7]|-8),(-?[0-7]|-8)$/.test(k))
      )
        return reply.code(400).send({ error: "Invalid terrain interest" });
      return {
        baselineHash: header.baseline.hash,
        publicCursor: header.publicCursor,
        chunks: await readChunks(pool, header, keys),
      };
    },
  );
  app.post<{ Body: CreateVillageInput & { development: boolean } }>(
    "/api/founding",
    { schema: { body: FoundingCreateSchema } },
    async (req, reply) => {
      const who = await authorizeMutation(req);
      if (!who)
        return reply
          .code(403)
          .send({ error: "Creator sign-in and a valid request are required." });
      if (req.body.name.trim().length < 3)
        return reply.code(400).send({
          error: "Choose a name with at least three non-padding characters.",
        });
      if (
        (config.wf2WorldId || config.production) &&
        !(
          await pool.query(
            "SELECT id FROM founding_jobs WHERE creator_id=$1 AND command_id=$2",
            [who.person_id, req.body.commandId],
          )
        ).rowCount
      )
        return reply
          .code(403)
          .send({ error: { code: "ONBOARDING_CLOSED", retryable: false } });
      const result = await enqueueFounding(
        pool,
        who.person_id,
        who.session_hash,
        req.body,
      );
      if ("conflict" in result)
        return reply.code(409).send({
          error:
            "World slot or command conflict. Existing saves are unchanged.",
        });
      runner.wake();
      return reply.code(202).send(result);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/founding-jobs/:id",
    { schema: { params: FoundingJobIdSchema } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const who = await session(req.cookies.cv_session);
      if (!who) return reply.code(404).send({ error: "Job unavailable" });
      const row = (
        await pool.query(
          "SELECT id,world_id,status,error FROM founding_jobs WHERE id=$1 AND creator_id=$2",
          [req.params.id, who.person_id],
        )
      ).rows[0];
      if (!row) return reply.code(404).send({ error: "Job unavailable" });
      return {
        jobId: row.id,
        worldId: row.world_id,
        status: row.status,
        error: row.error,
      };
    },
  );
  const assets = path.join(repositoryRoot, "assets/generated");
  if (config.production) await registerProductionWeb(app);
  else if (existsSync(assets))
    await app.register(staticFiles, {
      root: assets,
      prefix: "/assets/",
      decorateReply: false,
    });
  return app;
}
