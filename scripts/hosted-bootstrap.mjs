// Authenticated local operator only; never an HTTP server or production web command.
import fs from "node:fs/promises";
import { createPool, verifySchema } from "../apps/server/dist/database.js";
import { loadConfig } from "../apps/server/dist/config.js";
import { twitchGateway } from "../apps/server/dist/twitch.js";
import { hash } from "../apps/server/dist/security.js";
import {
  prepareHostedPlan,
  applyHostedPlan,
  hostedPlanHash,
} from "../apps/server/dist/hosted-bootstrap.js";
const [command, ...args] = process.argv.slice(2),
  flags = new Map();
let pool;
try {
  if (
    !["prepare", "apply"].includes(command) ||
    process.env.NODE_ENV !== "production" ||
    process.env.GAMEPLAY_WRITES !== "paused" ||
    process.env.DATABASE_TRANSPORT !== "tls"
  )
    throw Error("OPERATOR_MODE_REQUIRED");
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (
      ![
        "--plan-file",
        "--creator-login",
        "--name",
        "--seed",
        "--expect-plan-hash",
        "--confirm-hosted-test",
      ].includes(name) ||
      flags.has(name)
    )
      throw Error("INVALID_ARGUMENTS");
    flags.set(name, name === "--confirm-hosted-test" ? true : args[++i]);
  }
  const file = flags.get("--plan-file");
  if (typeof file !== "string") throw Error("PRIVATE_PLAN_FILE_REQUIRED");
  const url = new URL(process.env.MIGRATION_DATABASE_URL);
  if (
    !url.hostname.endsWith(".neon.tech") ||
    url.hostname.includes("-pooler") ||
    [...url.searchParams.keys()].some((k) => k.startsWith("ssl"))
  )
    throw Error("DIRECT_NEON_TLS_REQUIRED");
  process.env.DATABASE_URL = url.toString(); // This CLI never starts the serving process.
  const config = loadConfig(),
    provider = twitchGateway(config),
    target = hash(
      JSON.stringify({
        host: url.hostname,
        port: url.port || "5432",
        database: url.pathname,
      }),
    );
  pool = createPool(url.toString(), { rejectUnauthorized: true });
  await verifySchema(pool);
  if (command === "prepare") {
    for (const name of ["--creator-login", "--name", "--seed"])
      if (typeof flags.get(name) !== "string")
        throw Error("PLAN_INPUT_REQUIRED");
    const plan = await prepareHostedPlan(pool, provider, config.encryptionKey, {
      target,
      login: flags.get("--creator-login"),
      name: flags.get("--name"),
      seed: flags.get("--seed"),
    });
    await fs.writeFile(file, JSON.stringify(plan, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        status: "prepared-not-applied",
        policy: plan.policy,
        planHash: hostedPlanHash(plan),
      }),
    );
  } else {
    const plan = JSON.parse(await fs.readFile(file, "utf8"));
    const result = await applyHostedPlan(
      pool,
      provider,
      config.encryptionKey,
      plan,
      {
        target,
        expectedHash: flags.get("--expect-plan-hash"),
        confirm: flags.get("--confirm-hosted-test") === true,
        paused: true,
      },
    );
    console.log(JSON.stringify(result));
  }
} catch {
  console.error(
    "Hosted bootstrap refused or failed safely. Inspect the private plan, operator role, genuine creator session, target and approval; no identities or secrets logged.",
  );
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
