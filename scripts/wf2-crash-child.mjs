// Deliberate process death only against the named isolated invariant-test DB.
import { createPool } from "../apps/server/src/database.ts";
import {
  projectCommand,
  leaseCompletion,
  completeConstruction,
} from "../apps/server/src/participation-projects.ts";
process.loadEnvFile(".local/runtime.env");
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/creators_village_wf2_test";
if (process.env.WF2_CRASH_TEST !== "isolated-wf2-only")
  throw Error("Crash fixture guard required");
const pool = createPool(url.toString()),
  mode = process.env.WF2_CRASH_MODE;
if (mode === "contribute") {
  const person = process.env.WF2_CRASH_PERSON,
    project = process.env.WF2_CRASH_PROJECT;
  const p = (
    await pool.query("SELECT * FROM wf2_projects WHERE id=$1", [project])
  ).rows[0];
  const s = (
    await pool.query(
      "SELECT session_hash FROM sessions WHERE person_id=$1 AND expires_at>now() ORDER BY validated_at DESC LIMIT 1",
      [person],
    )
  ).rows[0];
  await projectCommand(
    pool,
    { person_id: person, session_hash: s.session_hash },
    p.world_id,
    {
      commandId: process.env.WF2_CRASH_COMMAND,
      commandSchema: "wf2-command-1",
      kind: "Contribute",
      payload: {
        projectId: project,
        planHash: p.plan_hash,
        recognitionOptIn: false,
      },
    },
  );
  // COMMIT completed; no HTTP response, wake or worker tick can occur in this child.
  process.exit(43);
}
const job = await leaseCompletion(pool);
if (!job) throw Error("No isolated completion intent");
await completeConstruction(
  pool,
  job,
  mode === "mid-transaction" ? () => process.exit(42) : undefined,
);
await pool.end();
