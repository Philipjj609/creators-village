# Creator's Village

**Give your Twitch community a place that remembers.**

A Twitch-connected browser prototype with persistent geography, private community admission and server-authoritative construction. Explore a saved village with pan, zoom and contextual project tools. An Extension, chat bot, EventSub integration and OBS overlay are not shipped features.

## Current hosted functionality — 31 October 2026

[Hosted application](https://creators-village.onrender.com/) · private prototype on Render Free with Neon PostgreSQL. Public creator onboarding remains closed. Twitch sign-in authenticates an account; it does not create a world or grant access to another person's village.

The deployed application source is `cb065bc8943ac4efde98389943a968e0c3455d70`. This documentation update does not deploy another build. Hosted verification established:

- Genuine creator Twitch authentication, provider validation and session continuity across reload.
- One fresh private creator-bound v2 world, with 256 persisted terrain chunks, founding shelter/path and preserved geography/ownership.
- Creator-enabled private participation and role-appropriate community/project controls.
- Authorized server-sent event connection opening and reopening after reload/navigation. Authenticated empty replay and stale-cursor reset were checked; delivery of a missed construction batch was not established.

At that verified handoff there were **zero invitations, construction projects and contributions**. Independent two-person Twitch construction, other-account admission/denial, real missed-event replay and hosted post-contribution restart verification remain pending. Hosting can sleep or interrupt streams; sustained availability/load and physical-device readiness are not established. World-art acceptance remains open.

## Implemented construction versus verification

The code implements explicit private requests/approval, creator-published workshop/path plans, deliberate per-project contributions, atomic same-world completion, private receipts and optional revocable recognition. These flows have been verified using synthetic browser participants against the real API and PostgreSQL in isolated local tests. Synthetic evidence is **not** independent-human Twitch play or hosted construction evidence.

The migration-006 release includes the restricted, operator-only hosted-bootstrap service/CLI and schema migration. Its one approved hosted initialization has completed. This is not a public creation endpoint or an instruction to run bootstrap again. The original snapshot's `candidateBootstrapIncluded: false` provenance field describes the initial publication; `subsequentReleases` records the later operator-code addition. Private operator plans, identities, credentials and operational receipts are intentionally absent.

Latest isolated source check (31 October): the full suite passed68 of69 tests; the concurrent same-plan operator-bootstrap retry test hit a PostgreSQL deadlock. A focused rerun passed all7 bootstrap tests, but the concurrency issue remains unresolved. No runtime fix is included in this documentation update. Do not interpret earlier green rehearsal results as proof that this race cannot occur, or rerun bootstrap on the existing hosted world. The production build/typecheck and container build pass. Full formatting still flags the unchanged lockfile; README formatting passes.

No economy, passive-watch rewards, follower-derived permissions or autonomous inhabitants are implemented. Testing does not waive private access, visual review or release conditions.

## Reproduce the source

Requirements: Node **24.22.1**, pnpm **11.6.0**, Docker for the isolated PostgreSQL option, and existing Playwright browser binaries for browser tests. Use an empty clone/directory and fresh local configuration; never point tests at a live database or copy production secrets/saves. Commands below run from the repository root. `scripts/use-local-node.ps1` is an optional helper only for a separately installed local portable runtime; that ignored runtime is not included.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r build
node scripts/build-release.mjs
pnpm typecheck
```

Use the retained source PNGs; the production build does not rerender Blender scenes or regenerate immutable artwork. Review [production runtime](docs/architecture/production-runbook.md), [migration-006 release evidence](docs/testing/bootstrap-release.md) and [operator bootstrap contract](docs/architecture/hosted-test-bootstrap.md). Older runbook authorization/provider statements describe earlier milestones; the dated hosted summary above is the current observed state. Nothing here authorizes another deployment, hosted migration or bootstrap.

### Isolated PostgreSQL and tests

In a fresh clone, `pnpm db:up` generates ignored local database/key configuration and starts pinned PostgreSQL18 on loopback55432 using Compose project `creators-village-s1`. **Do not use that default project/port on a machine already hosting a Creator's Village database.** On such a machine provision a different disposable PostgreSQL18 container/port and write its owner URL and a fresh token-encryption key into ignored `.local/runtime.env`; never replace existing live configuration. Tests create fixed test-database names and require a test-only owner with database-creation rights.

```powershell
# Fresh isolated machine/clone only; see collision warning above.
pnpm db:up
pnpm test
```

Migration checks cover001–006. Normal production startup verifies schema and does not migrate it. The supported production launcher is `node scripts/production.mjs serve`, with production configuration; migration/runtime identities remain separate. [Secret-free environment template](deploy/production.env.example) and the runbook document that setup. Provision/migrate commands are for a deliberately selected fresh test target, not this project's hosted world.

### Synthetic construction demonstration — local only

This path needs no real Twitch credentials. Use only the disposable loopback database above and non-production mode. `wf2-test-server.mjs` resets the fixed `creators_village_wf2_browser_test` database on startup; do not run multiple resetting fixtures concurrently. Never expose its fake-login routes outside loopback or use them against the hosted service.

```powershell
# Terminal 1: isolated fake-provider API on loopback3002
node scripts/wf2-test-server.mjs

# Terminal 2: web on loopback5174
$env:CV_DEV_API_TARGET = 'http://127.0.0.1:3002'
pnpm --filter @creators-village/web dev --host 127.0.0.1 --port 5174

# Terminal 3: existing installed Playwright Chromium required
$env:CV_EVIDENCE_DIR = '.local/submission-evidence'
node scripts/verify-pi1-browser.mjs
```

The verification script exercises two synthetic browser contexts, private approval, construction and recovery. Keep generated artifacts ignored and label any published footage **synthetic local integration test**. Viewport emulation does not establish physical mobile coverage. Synthetic test identities are not packaged in production.

### Genuine Twitch authentication — separate from synthetic tests

For a separate local OAuth evaluation, register an application through the [Twitch developer console](https://dev.twitch.tv/console/apps), configure `http://localhost:3000/auth/twitch/callback`, and copy `.env.example` to ignored `.env.local` with your own credentials. The registered callback and configured origin must match. Do not use this project's production secrets or request additional scopes. Start `pnpm dev:server` and `pnpm dev` in separate terminals after building. Local HTTP is development only; production uses the exact HTTPS origin/callback and secure cookies. Sign-in does not override onboarding/private-world policy.

## Judging access

The [official hackathon rules](https://twitchcon-codex.devpost.com/rules) permit a private GitHub or GitLab repository shared with **testing@devpost.com**, containing source, assets and run instructions. Access must be deliberately granted and verified; this README does not assert it has happened. The source and isolated synthetic setup support evaluation without production credentials. The hosted landing is public; the saved village remains private. Any hosted judge admission must use authorized request/creator-approval controls, never a shared creator session or bypass. Free working-project access through judging remains an entrant obligation; resolve uncertainty with the organizer before submission.

## Provenance and licensing

This repository has an audited independent publication history. Original development history and private coordination records are intentionally not ancestors or included artifacts. `PUBLICATION-PROVENANCE.json` preserves initial snapshot hashes and later source overlays; it is not a live operational log. See [license notice](LICENSE-NOTICE.md). No new open-source license or third-party rights grant is implied.

Required runtime assets and retained source/recipes are included. [Landing-art provenance](docs/research/landing-art-provenance.md) records owner-supplied ChatGPT concept artwork and selected authorized crops. These are illustrations, not gameplay screenshots, implemented characters or an exclusive-copyright/CC0 claim. Unused boards/ZIPs, private images, saves, IDs, secrets and operator records remain excluded. Dependencies retain their pinned upstream licenses.
