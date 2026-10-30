import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { Config } from "./config.js";
import {
  Wf2CommandSchema,
  Wf2WorldParams,
  Wf2ContinuationSchema,
  type Wf2Command,
  Wf2StateWire,
  Wf2EventsWire,
  Wf2MeWire,
  Wf2AdmissionWire,
  Wf2CreditsWire,
  Wf2CommandResultWire,
} from "@creators-village/contracts";
import {
  activate,
  bootstrap,
  Wf2Error,
  fail,
  authority,
  transaction,
  lockSession,
  type Actor,
} from "./participation-core.js";
import {
  admissionKinds,
  admissionCommand,
  issueContinuation,
  requestJoin,
  invitationLink,
} from "./participation-admission.js";
import { hash } from "./security.js";
import {
  projectCommand,
  withdrawRecognition,
  completionRunner,
} from "./participation-projects.js";
import { streamService, replay, cursor } from "./participation-events.js";
export type Wf2Auth = {
  session: (raw: string | undefined) => Promise<Actor | null>;
  mutation: (req: FastifyRequest) => Promise<Actor | null>;
};
export async function registerParticipation(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  auth: Wf2Auth,
) {
  const runner = completionRunner(
    pool,
    Boolean(config.wf2WorldId) && !config.writesPaused,
  );
  app.addHook("onClose", () => runner.close());
  const streams = streamService(app, pool, auth);
  await app.register(
    async (api) => {
      api.addHook("onResponse", async (_req, reply) => {
        try {
          await pool.query(
            "INSERT INTO wf2_operational_logs(code,duration_ms) VALUES($1,$2)",
            ["WF2_HTTP_" + reply.statusCode, Math.round(reply.elapsedTime)],
          );
        } catch {
          console.error("WF2 sanitized operational logging unavailable");
        }
      });
      api.addHook("onRequest", async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        reply.header("Referrer-Policy", "no-referrer");
        if (req.headers.origin && req.headers.origin !== config.webOrigin)
          fail("FORBIDDEN", 403);
        if (req.headers["sec-fetch-site"] === "cross-site")
          fail("FORBIDDEN", 403);
        const params = req.params as Record<string, string>;
        for (const [key, v] of Object.entries(params)) {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              v,
            )
          )
            fail("INVALID_INPUT", 400);
          params[key] = v.toLowerCase();
        }
      });
      api.addHook("preValidation", async (req) => {
        const normalize = (input: unknown) => {
          if (!input || typeof input !== "object") return;
          const record = input as Record<string, unknown>;
          for (const [key, value] of Object.entries(record))
            if (
              key.endsWith("Id") &&
              typeof value === "string" &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                value,
              )
            )
              record[key] = value.toLowerCase();
        };
        normalize(req.body);
        const p = (req.body as { payload?: unknown } | null)?.payload;
        normalize(p);
        if (p && typeof p === "object")
          for (const [key, value] of Object.entries(p))
            if (
              key.startsWith("expected") &&
              key.endsWith("Revision") &&
              typeof value === "string" &&
              /^[0-9]+$/.test(value) &&
              BigInt(value) > 9223372036854775807n
            )
              fail("INVALID_INPUT", 400);
      });
      api.setErrorHandler((e, _req, reply) => {
        const status = (e as { statusCode?: number }).statusCode;
        const w =
          e instanceof Wf2Error
            ? e
            : new Wf2Error(
                status === 429
                  ? "RATE_LIMITED"
                  : (e as { validation?: unknown }).validation ||
                      (status && status >= 400 && status < 500)
                    ? "INVALID_INPUT"
                    : "TEMPORARY_UNAVAILABLE",
                status === 429
                  ? 429
                  : (e as { validation?: unknown }).validation ||
                      (status && status >= 400 && status < 500)
                    ? 400
                    : 503,
                true,
              );
        return reply.code(w.status).send({
          error: {
            code: w.code,
            retryable: w.retryable,
            requestId: crypto.randomUUID(),
          },
        });
      });
      api.setNotFoundHandler(async () => {
        fail("NOT_FOUND", 404);
      });
      api.get<{
        Params: { worldId: string };
        Querystring: { after: string; limit?: string };
      }>(
        "/worlds/:worldId/events",
        { schema: { response: { 200: Wf2EventsWire } } },
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("NOT_FOUND", 404);
          return replay(
            pool,
            a,
            req.params.worldId,
            cursor(req.query.after),
            Number(req.query.limit ?? 100),
          );
        },
      );
      api.get<{ Params: { worldId: string }; Querystring: { after: string } }>(
        "/worlds/:worldId/stream",
        async (req, reply) => {
          await streams.open(
            req,
            reply,
            req.params.worldId,
            cursor(req.headers["last-event-id"] ?? req.query.after),
          );
        },
      );
      api.post<{ Params: { worldId: string }; Body: Wf2Command }>(
        "/worlds/:worldId/commands",
        {
          schema: {
            params: Wf2WorldParams,
            body: Wf2CommandSchema,
            response: { 200: Wf2CommandResultWire },
          },
        },
        async (req) => {
          const actor = await auth.mutation(req);
          if (!actor) fail("AUTH_REQUIRED", 403);
          if (req.params.worldId !== config.wf2WorldId) fail("NOT_FOUND", 404);
          if (req.body.kind === "RequestJoin") fail("UNSUPPORTED_SCHEMA", 400);
          const result =
            req.body.kind === "EnablePlaytest"
              ? await activate(
                  pool,
                  config,
                  actor,
                  req.body as Wf2Command & {
                    payload: { expectedBaselineHash: string };
                  },
                  req.params.worldId,
                )
              : admissionKinds.has(req.body.kind)
                ? await admissionCommand(
                    pool,
                    config,
                    actor,
                    req.params.worldId,
                    req.body,
                  )
                : await projectCommand(
                    pool,
                    actor,
                    req.params.worldId,
                    req.body,
                  );
          runner.wake();
          return { commandId: req.body.commandId, status: "committed", result };
        },
      );
      api.get<{ Params: { worldId: string } }>(
        "/worlds/:worldId/bootstrap",
        { schema: { params: Wf2WorldParams, response: { 200: Wf2StateWire } } },
        async (req) => {
          const actor = await auth.session(req.cookies.cv_session);
          if (!actor) fail("NOT_FOUND", 404);
          return bootstrap(pool, actor, req.params.worldId);
        },
      );
      const cookieOptions = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: config.secureCookies,
        path: "/",
      };
      api.post<{ Body: { token: string } }>(
        "/join/continuations",
        { schema: { body: Wf2ContinuationSchema } },
        async (req, reply) => {
          if (
            req.headers.origin !== config.webOrigin ||
            req.headers["x-wf2-join"] !== "1"
          )
            fail("FORBIDDEN", 403);
          if (!config.wf2WorldId) fail("NOT_FOUND", 404);
          const { cookie, ...r } = await issueContinuation(
            pool,
            req.body.token,
          );
          reply.setCookie("cv_join", cookie, {
            ...cookieOptions,
            maxAge: 86400,
          });
          return r;
        },
      );
      api.post<{ Body: Wf2Command }>(
        "/join/commands",
        {
          schema: {
            body: Wf2CommandSchema,
            response: { 200: Wf2CommandResultWire },
          },
        },
        async (req, reply) => {
          const actor = await auth.mutation(req);
          if (!actor) fail("AUTH_REQUIRED", 403);
          if (req.body.kind !== "RequestJoin") fail("UNSUPPORTED_SCHEMA", 400);
          if (!config.wf2WorldId) fail("NOT_FOUND", 404);
          const result = await requestJoin(
            pool,
            actor,
            req.body,
            req.cookies.cv_join,
          );
          reply.clearCookie("cv_join", cookieOptions);
          return { commandId: req.body.commandId, status: "committed", result };
        },
      );
      api.get<{ Params: { id: string } }>(
        "/join/continuations/:id",
        async (req) => {
          const actor = await auth.session(req.cookies.cv_session);
          if (!actor) fail("AUTH_REQUIRED", 403);
          if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !req.cookies.cv_join)
            fail("INVITE_EXPIRED", 410);
          const c = (
            await pool.query(
              "SELECT id,expires_at,completed_request_id FROM wf2_join_continuations WHERE id=$1 AND cookie_hash=$2 AND expires_at>now()",
              [req.params.id, hash(req.cookies.cv_join)],
            )
          ).rows[0];
          if (!c) fail("INVITE_EXPIRED", 410);
          const p = (
            await pool.query(
              "SELECT twitch_login,display_name FROM people WHERE id=$1",
              [actor.person_id],
            )
          ).rows[0]!;
          return {
            continuationId: c.id,
            expiresAt: c.expires_at.toISOString(),
            confirmed: Boolean(c.completed_request_id),
            account: { login: p.twitch_login, displayName: p.display_name },
          };
        },
      );
      api.get(
        "/me",
        { schema: { response: { 200: Wf2MeWire } } },
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("AUTH_REQUIRED", 403);
          return {
            grants: (
              await pool.query(
                'SELECT g.world_id AS "worldId",g.can_contribute AS "canContribute" FROM wf2_world_grants g JOIN wf2_memberships m USING(community_id,person_id) JOIN wf2_bindings b ON b.world_id=g.world_id WHERE g.person_id=$1 AND g.can_view AND m.state=\'active\' AND b.enabled',
                [a.person_id],
              )
            ).rows,
            requests: (
              await pool.query(
                'SELECT id AS "requestId",state,world_id AS "worldId" FROM wf2_join_requests WHERE person_id=$1 ORDER BY created_at DESC LIMIT 20',
                [a.person_id],
              )
            ).rows,
            receipts: (
              await pool.query(
                'SELECT command_id AS "commandId",project_id AS "projectId" FROM wf2_contributions WHERE person_id=$1 ORDER BY accepted_at DESC,id DESC LIMIT 20',
                [a.person_id],
              )
            ).rows,
          };
        },
      );
      api.get<{ Params: { id: string } }>("/join/requests/:id", async (req) => {
        const a = await auth.session(req.cookies.cv_session);
        if (!a) fail("NOT_FOUND", 404);
        const r = (
          await pool.query(
            'SELECT r.id AS "requestId",r.state,r.revision,m.state AS eligibility FROM wf2_join_requests r JOIN wf2_memberships m USING(community_id,person_id) WHERE r.id=$1 AND r.person_id=$2',
            [req.params.id, a.person_id],
          )
        ).rows[0];
        if (!r) fail("NOT_FOUND", 404);
        return r;
      });
      api.get<{ Params: { worldId: string; inviteId: string } }>(
        "/worlds/:worldId/invitations/:inviteId/link",
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("NOT_FOUND", 404);
          return invitationLink(
            pool,
            config,
            a,
            req.params.worldId,
            req.params.inviteId,
          );
        },
      );
      api.get<{ Params: { worldId: string }; Querystring: { after?: string } }>(
        "/worlds/:worldId/admission",
        { schema: { response: { 200: Wf2AdmissionWire } } },
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("NOT_FOUND", 404);
          return transaction(pool, async (db) => {
            const b = await authority(db, req.params.worldId, a, false, true);
            const after =
              req.query.after ?? "00000000-0000-0000-0000-000000000000";
            if (!/^[0-9a-f-]{36}$/i.test(after)) fail("INVALID_INPUT", 400);
            const requests = (
              await db.query(
                'SELECT r.id AS "requestId",r.revision,r.created_at AS "submittedAt",p.twitch_login AS login,p.display_name AS "displayName" FROM wf2_join_requests r JOIN people p ON p.id=r.person_id WHERE r.world_id=$1 AND r.state=\'pending\' AND r.id>$2 ORDER BY r.id LIMIT 20',
                [req.params.worldId, after],
              )
            ).rows;
            const members = (
              await db.query(
                'SELECT m.id AS "memberId",m.revision,m.state,p.twitch_login AS login,p.display_name AS "displayName" FROM wf2_memberships m JOIN people p ON p.id=m.person_id WHERE m.community_id=$1 AND m.person_id<>$2 AND m.id>$3 ORDER BY m.id LIMIT 20',
                [b.community_id, b.creator_id, after],
              )
            ).rows;
            return { requests, members };
          });
        },
      );
      api.get<{ Params: { commandId: string } }>(
        "/receipts/:commandId",
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("NOT_FOUND", 404);
          const r = (
            await pool.query(
              "SELECT command_id,kind,result,target_world_id FROM wf2_command_receipts WHERE person_id=$1 AND command_id=$2",
              [a.person_id, req.params.commandId],
            )
          ).rows[0];
          if (!r) fail("NOT_FOUND", 404);
          // Do not return map/community identifiers after access loss.
          const g = (
            await pool.query(
              "SELECT can_view FROM wf2_world_grants WHERE world_id=$1 AND person_id=$2",
              [r.target_world_id, a.person_id],
            )
          ).rows[0];
          return {
            commandId: r.command_id,
            kind: r.kind,
            result: g?.can_view
              ? r.result
              : {
                  accepted: true,
                  projectId: r.result.projectId ?? null,
                  contributionId: r.result.contributionId ?? null,
                  optedIn: r.result.optedIn ?? null,
                },
          };
        },
      );
      api.post<{ Body: Wf2Command }>(
        "/privacy/commands",
        {
          schema: {
            body: Wf2CommandSchema,
            response: { 200: Wf2CommandResultWire },
          },
        },
        async (req) => {
          const a = await auth.mutation(req);
          if (!a) fail("AUTH_REQUIRED", 403);
          if (req.body.kind !== "SetRecognition") fail("FORBIDDEN", 403);
          return {
            commandId: req.body.commandId,
            status: "committed",
            result: await withdrawRecognition(pool, a, req.body),
          };
        },
      );
      api.get<{ Params: { worldId: string; projectId: string } }>(
        "/worlds/:worldId/projects/:projectId/credits",
        { schema: { response: { 200: Wf2CreditsWire } } },
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("NOT_FOUND", 404);
          return transaction(pool, async (db) => {
            const b = await authority(db, req.params.worldId, a);
            const credits = (
              await db.query(
                "SELECT c.id AS \"creditId\",p.display_name AS label FROM wf2_contributions c JOIN wf2_credit_consents s USING(world_id,project_id,person_id) JOIN people p ON p.id=c.person_id JOIN wf2_memberships m ON m.community_id=c.community_id AND m.person_id=c.person_id JOIN wf2_world_grants g ON g.world_id=c.world_id AND g.person_id=c.person_id WHERE c.world_id=$1 AND c.project_id=$2 AND s.opted_in AND m.state='active' AND g.can_view ORDER BY c.accepted_at,c.id",
                [req.params.worldId, req.params.projectId],
              )
            ).rows;
            return { creditRevision: b.credit_revision, credits };
          });
        },
      );
      api.get<{
        Params: { worldId: string };
        Querystring: { state?: string; after?: string; limit?: string };
      }>("/worlds/:worldId/projects", async (req) => {
        const a = await auth.session(req.cookies.cv_session);
        if (!a) fail("NOT_FOUND", 404);
        return transaction(pool, async (db) => {
          await authority(db, req.params.worldId, a, false, true);
          if (req.query.state !== "draft") fail("INVALID_INPUT", 400);
          const after =
              req.query.after ?? "00000000-0000-0000-0000-000000000000",
            limit = Number(req.query.limit ?? 20);
          if (
            !/^[0-9a-f-]{36}$/i.test(after) ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 20
          )
            fail("INVALID_INPUT", 400);
          const { projectDto } = await import("./participation-core.js");
          return {
            projects: (
              await db.query(
                "SELECT * FROM wf2_projects WHERE world_id=$1 AND state='draft' AND id>$2 ORDER BY id LIMIT $3",
                [req.params.worldId, after, limit],
              )
            ).rows.map(projectDto),
          };
        });
      });
      api.get<{ Params: { worldId: string; projectId: string } }>(
        "/worlds/:worldId/projects/:projectId",
        async (req) => {
          const a = await auth.session(req.cookies.cv_session);
          if (!a) fail("NOT_FOUND", 404);
          return transaction(pool, async (db) => {
            const b = await authority(db, req.params.worldId, a);
            const p = (
              await db.query(
                "SELECT * FROM wf2_projects WHERE world_id=$1 AND id=$2",
                [req.params.worldId, req.params.projectId],
              )
            ).rows[0];
            if (!p || (!p.published_at && b.creator_id !== a.person_id))
              fail("NOT_FOUND", 404);
            const { projectDto } = await import("./participation-core.js");
            return projectDto(p);
          });
        },
      );
    },
    { prefix: "/api/wf2" },
  );
  return streams;
}
