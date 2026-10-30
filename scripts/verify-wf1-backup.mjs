import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createPool } from "../apps/server/dist/database.js";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL),
  admin = createPool(url.toString());
url.pathname = "/creators_village_wf1_test";
const source = createPool(url.toString());
const destination = "creators_village_wf1_restore_" + Date.now();
await admin.query(`CREATE DATABASE ${destination}`);
url.pathname = "/" + destination;
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
try {
  const dump = execFileSync(
    "docker",
    [...args, 'pg_dump -U "$POSTGRES_USER" -Fc creators_village_wf1_test'],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  await fs.mkdir(".local/evidence", { recursive: true });
  await fs.writeFile(".local/evidence/wf1-test-backup.dump", dump);
  execFileSync(
    "docker",
    [...args, `pg_restore -U "$POSTGRES_USER" -d ${destination}`],
    { input: dump, maxBuffer: 1024 * 1024 },
  );
  const signature = async (p) =>
    (
      await p.query(
        "SELECT w.id,w.baseline_hash,md5(w.header::text) AS header_hash,count(c.*)::int AS chunks,md5(string_agg(c.hash,',' ORDER BY c.y,c.x)) AS chunk_hash FROM founding_worlds w JOIN founding_chunks c ON c.world_id=w.id GROUP BY w.id ORDER BY w.id",
      )
    ).rows;
  const original = await signature(source),
    copy = await signature(restored);
  const equal = JSON.stringify(original) === JSON.stringify(copy);
  await fs.writeFile(
    "docs/testing/evidence/wf1/backup-recovery.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        sourceDatabase: "creators_village_wf1_test",
        restoredDatabase: destination,
        dumpBytes: dump.length,
        equal,
        worlds: original.length,
        signatures: original,
        limitations: [
          "Isolated test DB only; no live-world backup copied into evidence",
          "Local restore on same PostgreSQL18 server, not off-host disaster recovery; keys/binary artifacts are separately required",
        ],
      },
      null,
      2,
    ),
  );
  console.log({ equal, worlds: original.length, dumpBytes: dump.length });
  if (!equal) process.exitCode = 1;
} finally {
  await source.end();
  await restored.end();
  await admin.end();
}
