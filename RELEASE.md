# Hackathon R1 release notes

Tag: hackathon-2026-11-02-r1. Accepted input: F3.1 RC1. Runtime source and original asset bytes match the reviewed candidate. R1 selects source, omits temporary tools and updates release documentation.

## Persistence and activation

Migrations001–006 are unchanged. Migrations007–009 add separate Orb accounting/consent/payment tables, a versioned funding ruleset, optional road frontage and pinned per-community policy. Historical action-based projects and receipts retain their units.

Serving verifies the exact schema and never migrates automatically. After verified backup/restore and explicit approval, use the supported migration-owner command:

    NODE_ENV=production node scripts/production.mjs migrate

Supply credentials only through a secure operator environment, with verified TLS and bounded lock/statement/transaction timeouts. The launcher uses an advisory lock, one transaction and fingerprint-matched migration replay. Never embed credentials in commands or source.

Serving receives runtime credentials and explicit GAMEPLAY_WRITES disposition. Economy activation also requires COMMUNITY_ORBS=community-orbs-1 and the already approved private world ID. Absent means off; unknown versions fail startup. Do not bootstrap/reseed an existing world.

## Recovery

Pause writes and drain before migration. Schema6 images cannot serve schema9 directly. After accepted Orb activity, retain a compatible schema9 reader, pause new funding and prefer a forward fix. Do not drop accounting tables, reinterpret receipts or restore away accepted activity. Keep encrypted backups and matching encryption keys outside source control.

## Verification and limitations

Accepted F3.1 passed161 tests in34 files, typecheck/build/packaging and isolated creator/member browser checks. R1 repeats these from clean selected snapshots. No synthetic hosted contributions are authorized. Physical-device/Safari/screen-reader and independent-human Twitch checks remain separate. Orb artwork is provisional. The known concurrent operator-bootstrap retry deadlock is unchanged; never reinitialize production as a release shortcut.
