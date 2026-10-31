# Migration006 release verification

2026-10-31. Base publication2a9287c; original source history remains independent. Reviewed operator candidate integrated without changing authentication scopes, economy, ordinary ownership or world geography. Added an explicit production HTTP absence test for bootstrap routes and source artifacts. No bootstrap is authorized by publishing this release.

Verified locally: six-project build/typecheck;69 tests across17 files; targeted formatting; Docker build from the pinned Node24.22.1 base and existing frozen dependencies. Full formatting retains a pre-existing warning in unchanged pnpm-lock.yaml; the lock was not rewritten.

Isolated production-image rehearsal:10 groups pass with six migrations, idempotent rerun, private admission, HTTP/CSRF/static boundaries, authenticated SSE/replay, process-crash construction recovery, exactly-once completion, retained v1 reader/geography, paused operation, desktop/mobile-emulated browser surfaces, non-root app/no database listener, graceful shutdown and fail-closed production configuration. Synthetic identities/worlds are confined to the rehearsal database; these are not independent-human or hosted-world results.

Tested local image: sha256:db137ad6d709194a5fe7985a842b3dc24c84d7305b9b59a4f276c1216433de7b (392722641bytes). One local post-browser sample: app90.84MiB/0.05%CPU,PG41.34MiB/4.82%CPU on15.22GiB Docker VM budget; not peak, physical-device or hosted-capacity evidence. CPU/memory measurement on Free hosting remains unavailable through its paid-gated graphs.

The web process never imports the operator command entrypoint; runtime role cannot access the permit catalog. CLI uses real Twitch validation and exact private plan hash; no synthetic authentication handler is packaged. See [release/cutover and recovery contract](../architecture/hosted-test-bootstrap.md). Hosted migration/deployment results and identity-bearing evidence stay in the private coordination channel, not this source publication.
