import type { Pool } from "pg";
import type { TwitchGateway } from "./twitch.js";
import { validateSessionHash } from "./session-validation.js";
export async function revalidateSessions(
  pool: Pool,
  provider: TwitchGateway,
  key: string,
) {
  const sessions = (
    await pool.query("SELECT session_hash FROM sessions WHERE expires_at>now()")
  ).rows;
  for (const row of sessions)
    await validateSessionHash(pool, provider, key, row.session_hash, true);
}
