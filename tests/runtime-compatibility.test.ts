import { beforeAll, afterAll, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createPool } from "../apps/server/src/database.js";
// @ts-expect-error Local operator script deliberately has no ambient declaration package.
import {
  assertRuntime,
  root,
  serverArtifact,
} from "../scripts/server-runtime.mjs";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL!),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf2_runtime_test";
const pool = createPool(url.toString());
beforeAll(async () => {
  try {
    await admin.query("CREATE DATABASE creators_village_wf2_runtime_test");
  } catch (e) {
    if ((e as { code: string }).code !== "42P04") throw e;
  }
  await pool.query(
    "CREATE TABLE IF NOT EXISTS wf2_bindings(state_schema text NOT NULL)",
  );
  await pool.query("TRUNCATE wf2_bindings");
});
afterAll(async () => {
  await pool.end();
  await admin.end();
});
it("A05/G04: supported launcher rejects absent/mixed legacy artifacts once mutable-world bindings exist, including write-off rollback", async () => {
  const legacy = await fs.mkdtemp(
    path.join(root, ".local/wf2-legacy-artifact-"),
  );
  expect((await assertRuntime(pool, legacy, false)).mode).toBe(
    "founding-only-compatible",
  );
  await pool.query("INSERT INTO wf2_bindings VALUES('wf2-state-1')");
  await expect(assertRuntime(pool, legacy, false)).rejects.toThrow(
    "UNSUPPORTED_RUNTIME",
  );
  expect((await assertRuntime(pool, serverArtifact, false)).mode).toBe(
    "wf2-forward-reader",
  );
  const mixed = await fs.mkdtemp(path.join(root, ".local/wf2-mixed-artifact-"));
  await fs.cp(serverArtifact, mixed, { recursive: true });
  await fs.writeFile(
    path.join(mixed, "app.js"),
    "// An intentionally replaced historical artifact; must never be imported.\n",
  );
  await expect(assertRuntime(pool, mixed, false)).rejects.toThrow(
    "fingerprint mismatch",
  );
  await pool.query(
    "INSERT INTO wf2_bindings VALUES('future-state-not-supported')",
  );
  await expect(assertRuntime(pool, serverArtifact, false)).rejects.toThrow(
    "saved state reader unavailable",
  );
});
