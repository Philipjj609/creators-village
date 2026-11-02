import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ORB_POLICY,
  accrueOrbs,
  type OrbWallet,
} from "@creators-village/contracts";
export async function ensureOrbPolicy(db: PoolClient, community: string) {
  await db.query(
    "INSERT INTO f3_orb_communities(community_id,policy_version,policy) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [community, ORB_POLICY.version, ORB_POLICY],
  );
  const p = (
    await db.query(
      "SELECT policy FROM f3_orb_communities WHERE community_id=$1",
      [community],
    )
  ).rows[0].policy;
  if (Object.entries(ORB_POLICY).some(([key, value]) => p[key] !== value))
    throw Error("Orb policy version mismatch");
}
export async function wallet(
  db: PoolClient,
  community: string,
  person: string,
): Promise<OrbWallet> {
  await ensureOrbPolicy(db, community);
  const created = await db.query(
    "INSERT INTO f3_orb_wallets(community_id,person_id,balance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *",
    [community, person, ORB_POLICY.starting],
  );
  if (created.rowCount)
    await entry(
      db,
      community,
      person,
      "start",
      "start",
      ORB_POLICY.starting,
      ORB_POLICY.starting,
    );
  const w = (
    await db.query(
      "SELECT *,extract(epoch FROM last_seen)*1000 AS seen_ms FROM f3_orb_wallets WHERE community_id=$1 AND person_id=$2 FOR UPDATE",
      [community, person],
    )
  ).rows[0];
  const now = Math.max(
      Number(w.seen_ms),
      Number(
        (
          await db.query(
            "SELECT extract(epoch FROM clock_timestamp())*1000 AS ms",
          )
        ).rows[0].ms,
      ),
    ),
    next = accrueOrbs(
      w.balance,
      w.remainder_ms,
      Math.max(0, now - Number(w.seen_ms)),
    );
  const balance = w.balance + next.award;
  const changed = (
    await db.query(
      "UPDATE f3_orb_wallets SET balance=$3,remainder_ms=$4,last_seen=to_timestamp($5/1000.0),revision=revision+1 WHERE community_id=$1 AND person_id=$2 RETURNING revision",
      [community, person, balance, Math.floor(next.remainder), now],
    )
  ).rows[0];
  if (next.award)
    await entry(
      db,
      community,
      person,
      "earn:" + changed.revision,
      "earn",
      next.award,
      balance,
    );
  return {
    version: ORB_POLICY.version,
    balance,
    revision: changed.revision,
    serverTime: now,
    nextAwardInMs: ORB_POLICY.intervalMs - Math.floor(next.remainder),
    cap: ORB_POLICY.accrualCap,
    award: ORB_POLICY.award,
    intervalMs: ORB_POLICY.intervalMs,
  };
}
export async function entry(
  db: PoolClient,
  community: string,
  person: string,
  key: string,
  kind: string,
  amount: number,
  balance: number,
  project: string | null = null,
) {
  await db.query(
    "INSERT INTO f3_orb_ledger(id,community_id,person_id,entry_key,kind,amount,balance_after,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [randomUUID(), community, person, key, kind, amount, balance, project],
  );
}
export async function refundOrbs(db: PoolClient, project: Record<string, any>) {
  if (project.ruleset_id !== ORB_POLICY.version) return;
  const people = (
    await db.query(
      "SELECT person_id,sum(amount)::int AS amount FROM f3_orb_contributions WHERE project_id=$1 GROUP BY person_id ORDER BY person_id",
      [project.id],
    )
  ).rows;
  for (const p of people) {
    await db.query(
      "SELECT person_id FROM f3_orb_wallets WHERE community_id=$1 AND person_id=$2 FOR UPDATE",
      [project.community_id, p.person_id],
    );
    if (
      (
        await db.query(
          "SELECT 1 FROM f3_orb_ledger WHERE community_id=$1 AND person_id=$2 AND entry_key=$3",
          [project.community_id, p.person_id, "refund:" + project.id],
        )
      ).rowCount
    )
      continue;
    const w = (
      await db.query(
        "UPDATE f3_orb_wallets SET balance=balance+$3,revision=revision+1 WHERE community_id=$1 AND person_id=$2 RETURNING balance",
        [project.community_id, p.person_id, p.amount],
      )
    ).rows[0];
    await entry(
      db,
      project.community_id,
      p.person_id,
      "refund:" + project.id,
      "refund",
      p.amount,
      w.balance,
      project.id,
    );
  }
}
