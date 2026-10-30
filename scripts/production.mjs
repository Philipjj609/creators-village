// Supported production entrypoint. No local env loading, synthetic gateway or test login.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadConfig } from "../apps/server/dist/config.js";
import {
  createPool,
  migrate,
  verifySchema,
} from "../apps/server/dist/database.js";
import { assertRuntime } from "./server-runtime.mjs";
const command = process.argv[2] ?? "serve";
let pool, app;
try {
  if (process.env.NODE_ENV !== "production")
    throw Error("Production mode required");
  if (!["serve", "migrate", "provision-runtime"].includes(command))
    throw Error("Unknown production command");
  if (
    command === "serve" &&
    (process.env.MIGRATION_DATABASE_URL ||
      process.env.RUNTIME_DATABASE_PASSWORD)
  )
    throw Error("Privileged setup credentials forbidden in serving process");
  const config = command === "serve" ? loadConfig() : null;
  const port = Number(process.env.PORT ?? 10000);
  if (
    command === "serve" &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  )
    throw Error("Invalid listening port");
  const url = new URL(
    command !== "serve"
      ? process.env.MIGRATION_DATABASE_URL
      : config.databaseUrl,
  );
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("Invalid database protocol");
  // pg URL ssl parameters can override explicit TLS options; prohibit that ambiguity.
  if ([...url.searchParams.keys()].some((k) => k.startsWith("ssl")))
    throw Error("Configure verified database TLS separately");
  const transport = process.env.DATABASE_TRANSPORT ?? "tls";
  if (!["tls", "private-network"].includes(transport))
    throw Error("Invalid database transport");
  if (
    transport === "private-network" &&
    !["db", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !/^dpg-[a-z0-9-]+$/.test(url.hostname)
  )
    throw Error(
      "Private transport requires a reviewed private database hostname",
    );
  const ca = process.env.DATABASE_CA_FILE
    ? await fs.readFile(process.env.DATABASE_CA_FILE, "utf8")
    : undefined;
  pool = createPool(
    url.toString(),
    transport === "tls"
      ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
      : undefined,
  );
  if (
    Number(
      (await pool.query("SHOW server_version_num")).rows[0].server_version_num,
    ) < 170000
  )
    throw Error(
      "PostgreSQL 17 or newer required for transaction timeout contracts",
    );
  if (command !== "serve") {
    await migrate(pool);
    await verifySchema(pool);
    if (command === "provision-runtime") {
      const password = process.env.RUNTIME_DATABASE_PASSWORD ?? "";
      if (!/^[0-9a-f]{64}$/.test(password))
        throw Error("Fresh 32-byte hex runtime password required");
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        // Initial provisioning only; never silently rotate an existing role or its privileges.
        await db.query(`CREATE ROLE cv_runtime LOGIN PASSWORD '${password}'`);
        const database = (await db.query("SELECT current_database() AS name"))
          .rows[0].name;
        await db.query(
          'GRANT CONNECT ON DATABASE "' +
            database.replaceAll('"', '""') +
            '" TO cv_runtime',
        );
        await db.query(await fs.readFile("deploy/runtime-grants.sql", "utf8"));
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
    console.log("Production migrations verified");
    await pool.end();
  } else {
    await verifySchema(pool);
    await assertRuntime(pool, undefined, true);
    const authority = (
      await pool.query(
        "SELECT r.rolsuper,r.rolcreatedb,has_schema_privilege(current_user,'public','CREATE') AS ddl FROM pg_roles r WHERE r.rolname=current_user",
      )
    ).rows[0];
    if (authority.rolsuper || authority.rolcreatedb || authority.ddl)
      throw Error("Runtime database identity must not have DDL privileges");
    const calibration = JSON.parse(
      await fs.readFile(
        "docs/testing/evidence/wf2/source-calibration.json",
        "utf8",
      ),
    );
    for (const [file, expected] of [
      [calibration.source, calibration.sourceSha256],
      [
        "assets/generated/hearthside-hero-01/manifest.json",
        calibration.assetManifestSha256,
      ],
    ])
      if (
        createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex") !== expected
      )
        throw Error("Construction proof fingerprint mismatch");
    if (
      process.env.GAMEPLAY_WRITES !== "enabled" &&
      process.env.GAMEPLAY_WRITES !== "paused"
    )
      throw Error("Explicit gameplay write disposition required");
    const { buildApp } = await import("../apps/server/dist/app.js");
    const { twitchGateway } = await import("../apps/server/dist/twitch.js");
    // Startup provider validation is performed lazily, before an authenticated request succeeds.
    // Invalidate freshness without making readiness depend on an unbounded Twitch scan.
    await pool.query(
      "UPDATE sessions SET validated_at=LEAST(validated_at,now()-interval '56 minutes') WHERE expires_at>now()",
    );
    app = await buildApp(config, pool, twitchGateway(config));
    let draining = false;
    app.get("/livez", async (_req, reply) =>
      reply
        .code(draining ? 503 : 200)
        .send({ status: draining ? "draining" : "ok" }),
    );
    app.get("/readyz", async (_req, reply) => {
      try {
        if (draining) throw Error("Draining");
        await pool.query("SELECT 1");
        return reply.send({ status: "ready" });
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    });
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, () => {
        draining = true;
        const deadline = setTimeout(() => {
          console.error("Shutdown deadline reached; durable leases retained");
          process.exit(1);
        }, 30000);
        deadline.unref();
        void app
          .close()
          .then(() => pool.end())
          .then(() => {
            clearTimeout(deadline);
            process.exit(0);
          })
          .catch(() => process.exit(1));
      });
    await app.listen({ host: process.env.HOST ?? "0.0.0.0", port });
    console.log("Creator's Village production runtime ready");
  }
} catch {
  console.error(
    "Production startup failed: verify environment, database role/schema, TLS and release artifacts. No configuration values logged.",
  );
  if (app) await app.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  process.exitCode = 1;
}
