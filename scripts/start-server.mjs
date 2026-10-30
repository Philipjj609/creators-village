import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { assertRuntime, root, serverArtifact } from "./server-runtime.mjs";
const require = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
);
const { Pool } = require("pg");
const privateConfig = path.join(root, ".local/wf2.env");
if (existsSync(privateConfig)) process.loadEnvFile(privateConfig);
if (!process.env.DATABASE_URL)
  throw Error("Load ignored local database configuration before startup");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
try {
  await assertRuntime(
    pool,
    serverArtifact,
    Boolean(process.env.WF2_APPROVED_WORLD_ID),
  );
} finally {
  await pool.end();
}
await import(pathToFileURL(path.join(root, "apps/server/dist/index.js")).href);
