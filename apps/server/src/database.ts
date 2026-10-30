import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "./security.js";
export const repositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
export function createPool(
  connectionString: string,
  ssl?: { rejectUnauthorized: true; ca?: string },
) {
  const pool = new Pool({
    connectionString,
    ...(ssl ? { ssl } : {}),
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () =>
    console.error("Database idle connection closed; pool will reconnect."),
  );
  return pool;
}
/** Read-only startup fence: deploy migrations separately with the migration identity. */
export async function verifySchema(pool: Pool) {
  const applied = await pool.query<{ name: string; checksum: string }>(
    "SELECT name,checksum FROM schema_migrations ORDER BY name",
  );
  const names = (await fs.readdir(path.join(repositoryRoot, "db/migrations")))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  if (applied.rows.length !== names.length)
    throw Error("Database schema does not match release");
  for (const name of names) {
    const sql = (
      await fs.readFile(
        path.join(repositoryRoot, "db/migrations", name),
        "utf8",
      )
    ).replaceAll("\r\n", "\n");
    const row = applied.rows.find((r) => r.name === name);
    if (
      !row ||
      ![hash(sql), hash(sql.replaceAll("\n", "\r\n"))].includes(row.checksum)
    )
      throw Error("Database migration fingerprint mismatch");
  }
}
export async function migrate(pool: Pool) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(10281028)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (
      await fs.readdir(path.join(repositoryRoot, "db/migrations"))
    )
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const rawSql = await fs.readFile(
        path.join(repositoryRoot, "db/migrations", name),
        "utf8",
      );
      // Canonical LF checksums are portable; accept historical CRLF checksums without rewriting them.
      const sql = rawSql.replaceAll("\r\n", "\n");
      const compatibleChecksums = [
        hash(sql),
        hash(sql.replaceAll("\n", "\r\n")),
      ];
      const old = await db.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (old.rows[0]) {
        if (!compatibleChecksums.includes(old.rows[0].checksum))
          throw new Error("Applied migration changed: " + name);
        continue;
      }
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, hash(sql)],
      );
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
