# One-time hosted development bootstrap

The bootstrap is an operator CLI, never an HTTP endpoint. Migration006 adds a single permit catalog and a founding-job origin marker. Existing rows retain creator origin; ordinary creator/world rules remain. The runtime role has no permit-table privileges, including privileges inherited from future-table defaults. SECURITY DEFINER slot validation fixes search_path to pg_catalog and checks the issuing database login.

Prepare requires a direct TLS migration-owner connection, production mode with gameplay paused, a genuine unexpired creator session and real Twitch validation. The private24h plan binds database/role/person/provider fingerprint, world/job/command identities, seed, generator/assets and release hashes. Preparation creates no world or permit; normal OAuth refresh may occur. Do not expose plan identifiers or provider subjects in public reports.

Apply requires separate owner approval for the exact plan hash and explicit confirmation. It checks an empty world/job/project/contribution history, consumes a singleton permit atomically and invokes the normal persistent generator. The output is one development world with hosted-test provenance, a founding shelter and initial path. It never fabricates a legacy world, contributions, membership or achievements. No HTTP login or public onboarding bypass exists. The ordinary worker cannot resume operator-origin jobs.

Same-plan retries retain identities/geography and permit at most three attempts with one live lease. A changed actor, target, release, plan or expired approval fails closed. Ready worlds are never overwritten. Failed committed jobs remain inspectable; recovery does not release a permit for a different plan.

## Release and recovery

The005 reader accepts only001–005; the compatible006 reader accepts001–006. Avoid a mixed-version restart window: build/test/audit the compatible release first, protect database/key, suspend the old service, migrate transactionally with the owner, then manually deploy/resume the compatible release with gameplay still paused. Retain the same database and encryption key. Verify migration fingerprints, restricted-role denial, identity/session continuity, HTTP isolation and readiness before preparing the plan.

On Free hosting, sleep/restart is normal operational behavior. Do not rely on an old process staying alive after migration. After006 commits, rollback means a schema-compatible reader/forward repair; never restart the005 image, down-migrate, reseed or restore an older database over accepted activity. If cutover cannot complete, remain suspended rather than weaken startup validation. Keep public onboarding and gameplay closed until separately authorized.

Private plans/backups/secrets require restrictive OS ACLs, not just Git exclusion. No privileged setup credentials enter the web environment. Backup encryption keys and the hosted token key are retained separately from code. Operator commands and artifacts are excluded from the static HTTP allowlist; regression tests exercise this boundary.
