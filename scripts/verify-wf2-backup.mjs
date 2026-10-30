import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createPool } from "../apps/server/dist/database.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf2_test";
const source = createPool(url.toString()),
  name = "creators_village_wf2_recovery_" + Date.now();
url.pathname = "/" + name;
const restored = createPool(url.toString());
const args = [
  "compose",
  "-p",
  "creators-village-s1",
  "exec",
  "-T",
  "db",
  "sh",
  "-c",
];
const signature = async (db) => {
  const tables = (
      await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename),
    out = {};
  for (const t of tables) {
    if (!/^[a-z0-9_]+$/.test(t)) throw Error("Unexpected fixture table");
    const rows = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    out[t] = {
      rows: rows.length,
      hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return out;
};
try {
  const dump = execFileSync(
    "docker",
    [...args, 'pg_dump -U "$POSTGRES_USER" -Fc creators_village_wf2_test'],
    { maxBuffer: 80 * 1024 * 1024 },
  );
  await fs.mkdir(".local/backups", { recursive: true });
  await fs.writeFile(".local/backups/wf2-isolated-recovery.dump", dump, {
    mode: 0o600,
  });
  await admin.query(`CREATE DATABASE ${name}`);
  execFileSync(
    "docker",
    [...args, `pg_restore -U "$POSTGRES_USER" -d ${name}`],
    { input: dump, maxBuffer: 1024 * 1024 },
  );
  const a = await signature(source),
    b = await signature(restored),
    equal = JSON.stringify(a) === JSON.stringify(b);
  if (!equal) throw Error("Recovery facts differ");
  const report = {
    date: new Date().toISOString(),
    source: "Named isolated WF2 invariant database",
    restored: true,
    allTablesEqual: equal,
    tableCount: Object.keys(a).length,
    dumpBytes: dump.length,
    tableRowCounts: Object.fromEntries(
      Object.entries(a).map(([k, v]) => [k, v.rows]),
    ),
    limitations: [
      "Same-server local restore only; no off-host disaster-recovery claim",
      "Private dump stays ignored; no row values/identities/tokens/seeds or private URLs published",
      "No live source mutation or reset",
    ],
  };
  await fs.writeFile(
    "docs/testing/evidence/wf2/backup-recovery.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      restored: true,
      allTablesEqual: equal,
      tables: Object.keys(a).length,
    }),
  );
} finally {
  await source.end();
  await restored.end();
  await admin.end();
}
