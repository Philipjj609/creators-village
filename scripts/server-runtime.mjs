// Supported-startup compatibility fence. No executable candidate module is imported here.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const serverArtifact = path.join(root, "apps/server/dist");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function stampRuntime() {
  const files = {},
    dependencies = {};
  for (const name of (await fs.readdir(serverArtifact))
    .filter((n) => n.endsWith(".js"))
    .sort())
    files[name] = digest(await fs.readFile(path.join(serverArtifact, name)));
  for (const pkg of ["contracts", "world", "domain"])
    for (const name of (
      await fs.readdir(path.join(root, "packages", pkg, "dist"))
    )
      .filter((n) => n.endsWith(".js"))
      .sort()) {
      const key = `packages/${pkg}/dist/${name}`;
      dependencies[key] = digest(await fs.readFile(path.join(root, key)));
    }
  await fs.writeFile(
    path.join(serverArtifact, "runtime-manifest.json"),
    JSON.stringify(
      {
        runtime: "wf2-reader-1",
        readerSchemas: ["wf2-state-1"],
        files,
        dependencies,
      },
      null,
      2,
    ) + "\n",
  );
}
export async function assertRuntime(
  pool,
  artifact = serverArtifact,
  requireWf2 = false,
) {
  const exists = (
    await pool.query(
      "SELECT to_regclass('public.wf2_bindings') IS NOT NULL AS present",
    )
  ).rows[0].present;
  const schemas = exists
    ? (
        await pool.query("SELECT DISTINCT state_schema FROM wf2_bindings")
      ).rows.map((r) => r.state_schema)
    : [];
  if (!requireWf2 && !schemas.length)
    return { mode: "founding-only-compatible" };
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(artifact, "runtime-manifest.json"), "utf8"),
    );
  } catch {
    throw Error(
      "UNSUPPORTED_RUNTIME: retained WF2 reader required; no compatible artifact manifest",
    );
  }
  if (
    !Array.isArray(manifest.readerSchemas) ||
    !manifest.readerSchemas.includes("wf2-state-1") ||
    schemas.some((s) => !manifest.readerSchemas.includes(s))
  )
    throw Error("UNSUPPORTED_RUNTIME: saved state reader unavailable");
  for (const name of [
    "index.js",
    "app.js",
    "participation-core.js",
    "participation-http.js",
  ])
    if (!manifest.files?.[name])
      throw Error("UNSUPPORTED_RUNTIME: incomplete artifact");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (
      !/^[a-z0-9-]+\.js$/.test(name) ||
      digest(await fs.readFile(path.join(artifact, name))) !== expected
    )
      throw Error("UNSUPPORTED_RUNTIME: server artifact fingerprint mismatch");
  }
  if (!manifest.dependencies || Object.keys(manifest.dependencies).length === 0)
    throw Error("UNSUPPORTED_RUNTIME: missing dependency fingerprint");
  for (const [name, expected] of Object.entries(manifest.dependencies)) {
    if (
      !/^packages\/(contracts|world|domain)\/dist\/[a-z0-9-]+\.js$/.test(
        name,
      ) ||
      digest(await fs.readFile(path.join(root, name))) !== expected
    )
      throw Error(
        "UNSUPPORTED_RUNTIME: workspace artifact fingerprint mismatch",
      );
  }
  return { mode: "wf2-forward-reader", readerSchemas: manifest.readerSchemas };
}
if (process.argv[2] === "--stamp") await stampRuntime();
