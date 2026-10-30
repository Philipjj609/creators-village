# Creator's Village

Private hosted-integration source snapshot. Persistent Twitch community worlds with server-authoritative geography, private admission, shared construction and authenticated SSE/recovery.

## Reproduce

Use Node24.22.1 and pnpm11.6.0. Install with pnpm install --frozen-lockfile --ignore-scripts. Run pnpm -r build, node scripts/build-release.mjs, then pnpm test with a separately provisioned isolated PostgreSQL18 database via ignored .local/runtime.env. Tests must never use a live database. Browser tests require running the app and approved Playwright browser binaries; viewport emulation is not physical-device verification.

Dockerfile builds the same-origin production app with pinned Node, non-root runtime, verified environment/schema/asset fences and separate migrations. See docs/architecture/production-runbook.md and deploy/production.env.example. Real Twitch credentials live only in secret storage. Public creator onboarding stays closed; no wallet or passive-watch rewards.

This snapshot contains PI2 plus the documented atomic session-freshness correction in publication-overlays/. The later bootstrap candidate is not included. World-art acceptance and the independent two-person Twitch test remain pending. This is a private integration source publication, not public-release readiness or a hackathon submission.

See PUBLICATION-PROVENANCE.json for exact upstream commit and file hashes. The original development history and private evidence remain local. No local saves, identities, receipts, backups, private screenshots or coordination documents were imported. No application deployment or paid action is authorized by this repository.
