import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { decrypt, encrypt } from "./security.js";
import { ProviderError, type Tokens, type TwitchGateway } from "./twitch.js";
export type Session = {
  session_hash: string;
  person_id: string;
  csrf_token: string;
  encrypted_tokens: string;
  token_expires_at: Date;
  validated_at: Date;
  expires_at: Date;
  display_name: string;
  twitch_subject: string;
  validation_lease: string | null;
  validation_lease_until: Date | null;
};
export async function validateSessionHash(
  pool: Pool,
  provider: TwitchGateway,
  key: string,
  sessionHash: string,
  force = false,
): Promise<Session | null> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const row = (
      await pool.query<Session>(
        "SELECT s.*,p.display_name,p.twitch_subject FROM sessions s JOIN people p ON p.id=s.person_id WHERE session_hash=$1 AND expires_at>now()",
        [sessionHash],
      )
    ).rows[0];
    if (!row) return null;
    const stale =
      Date.now() - row.validated_at.getTime() > 3300000 ||
      row.token_expires_at.getTime() < Date.now() + 60000;
    if (
      !stale &&
      !force &&
      (!row.validation_lease_until ||
        row.validation_lease_until.getTime() <= Date.now())
    )
      return row;
    const lease = randomUUID();
    const claim = await pool.query(
      "UPDATE sessions SET validation_lease=$1,validation_lease_until=now()+interval '30 seconds' WHERE session_hash=$2 AND encrypted_tokens=$3 AND expires_at>now() AND (validation_lease_until IS NULL OR validation_lease_until<now()) AND ($4::boolean OR validated_at<clock_timestamp()-interval '55 minutes' OR token_expires_at<clock_timestamp()+interval '1 minute') RETURNING session_hash",
      [lease, sessionHash, row.encrypted_tokens, force],
    );
    if (!claim.rowCount) {
      force = false;
      await new Promise((r) => setTimeout(r, 40));
      continue;
    }
    let generation = row.encrypted_tokens;
    try {
      let tokens = decrypt<Tokens>(generation, key),
        expiry = row.token_expires_at;
      if (expiry.getTime() < Date.now() + 60000) {
        tokens = await provider.refresh(tokens.refresh_token);
        expiry = new Date(Date.now() + tokens.expires_in * 1000);
        const rotated = encrypt(tokens, key);
        const saved = await pool.query(
          "UPDATE sessions SET encrypted_tokens=$1,token_expires_at=$2 WHERE session_hash=$3 AND encrypted_tokens=$4 AND validation_lease=$5 AND validation_lease_until>now() AND expires_at>now()",
          [rotated, expiry, sessionHash, generation, lease],
        );
        if (!saved.rowCount) {
          force = false;
          continue;
        }
        generation = rotated;
      }
      const identity = await provider.validate(tokens.access_token);
      if (identity.subject !== row.twitch_subject) throw new ProviderError(401);
      const updated = await pool.query(
        "UPDATE sessions SET validated_at=now(),validation_lease=NULL,validation_lease_until=NULL WHERE session_hash=$1 AND encrypted_tokens=$2 AND validation_lease=$3 AND validation_lease_until>now() AND expires_at>now()",
        [sessionHash, generation, lease],
      );
      if (!updated.rowCount) {
        force = false;
        continue;
      }
      await pool.query(
        "UPDATE people SET twitch_login=COALESCE($1,twitch_login),display_name=$2 WHERE id=$3",
        [identity.login ?? null, identity.displayName, row.person_id],
      );
      return {
        ...row,
        encrypted_tokens: generation,
        token_expires_at: expiry,
        validated_at: new Date(),
        display_name: identity.displayName,
        validation_lease: null,
        validation_lease_until: null,
      };
    } catch (e) {
      if (e instanceof ProviderError && [400, 401, 403].includes(e.status)) {
        const deleted = await pool.query(
          "DELETE FROM sessions WHERE session_hash=$1 AND encrypted_tokens=$2 AND validation_lease=$3",
          [sessionHash, generation, lease],
        );
        if (deleted.rowCount) return null;
        force = false;
        continue;
      }
      throw e;
    } finally {
      await pool.query(
        "UPDATE sessions SET validation_lease=NULL,validation_lease_until=NULL WHERE session_hash=$1 AND validation_lease=$2",
        [sessionHash, lease],
      );
    }
  }
  throw new ProviderError(503);
}
