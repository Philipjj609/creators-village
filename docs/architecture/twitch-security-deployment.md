# Twitch, trust boundaries and deployment

Status: provider facts checked in discovery on 2026-10-28; subsequent user review adopts confidential-server Twitch authorization-code OAuth without assumed PKCE, honest/tested EventSub gap handling, and a lightweight Extension separate from the renderer. Transport choice, exact scopes and detailed security/deployment mechanisms remain proposed. Live credentials, app registration, channel access and integration behavior were not tested. Production remains unapproved.

## Permissions and identity

| Scenario | Proposed authorization | Boundary |
|---|---|---|
| Public exploration | Anonymous read projection | No membership/presence/character implied; access policy enforced per village |
| Website identity / creator setup | Confidential backend authorization-code OAuth, validated provider identity | Server-held secret/tokens; state, exact redirect, secure session; verify creator subject before channel association |
| Followed village discovery | Optional `user:read:follows`; paginated followed-channel API intersected with participating directory | Declining scope still permits public links; minimize/cache only necessary membership discovery data |
| First live event | Recommended installed creator-authorized `channel.chat.message` via EventSub WebSocket, `user:read:chat` | Actual opt-in command/activity rule; read only, no chat sending in initial slice |
| Cloud bot alternative | App-token architecture has additional `user:bot` and broadcaster `channel:bot` or moderator requirements | Do not copy installed-bot scopes into hosted multi-channel topology blindly |
| Extension contribution | Extension Helper authorization JWT verified by EBS; approved linked global person | Verify supported signing algorithm, decoded shared secret, expiry, channel, role, identity; channel must match configured community |
| OBS overlay | Public projection or revocable read-only scoped token | Never reuse creator OAuth/session or allow writes via browser-source URL |

[OAuth flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [follow endpoint](https://dev.twitch.tv/docs/api/reference#get-followed-channels), [chat auth modes](https://dev.twitch.tv/docs/chat/authenticating/), [Extension backend verification](https://dev.twitch.tv/docs/extensions/building/).

Correction to Drive: PKCE is not established by the reviewed Twitch authorization-code documentation. Use documented server-backed exchange; do not claim provider support based on generic OAuth advice. Validate token client ID, subject and scopes at login; validate on startup and hourly for maintained OAuth sessions, terminate sessions on revocation, handle 401 and serialize refresh-token rotation. Encrypt refresh/access tokens with a key held outside the database and redact logs. Do not request email, follow, subscription or moderator scopes for basic identity by default. [Token validation requirement](https://dev.twitch.tv/docs/authentication/validate-tokens/).

Extension opaque/anonymous IDs are not cross-app person IDs. Require explicit identity sharing/link proof before spending a global user's balance; do not auto-link by name. Anonymous users get read-only state and a clear link flow. Website cookies are unreliable inside third-party iframes; Extension JWT authentication is a separate adapter into the same command service. Never confuse `helixToken` with the EBS authorization JWT. [Frontend token distinction](https://dev.twitch.tv/docs/extensions/frontend-api-usage/).

## Event ingestion and rewards

WebSocket inbound: one durable adapter owns subscriptions/session, persists authenticated received events into inbox, then idempotently processes them. Handle keepalive, planned reconnect and revocation; on an unplanned disconnect reconnect and recreate subscriptions. Twitch documents **no replay for the disconnected interval**. A local inbox does not fix missing upstream data. Show degraded ingestion and resume; do not fabricate reward backfill. [EventSub WebSockets](https://dev.twitch.tv/docs/eventsub/handling-websocket-events).

Hosted alternative: webhook with public HTTPS callback, exact raw-body HMAC verification, timing-safe comparison, message timestamp freshness (reject stale messages per provider guidance), challenge/revocation handling and durable inbox before acknowledgement. Deduplicate provider message IDs; enforce payload limits before parsing. Acknowledge quickly, process asynchronously. Delivery is at least once, not exactly once or guaranteed forever. [Webhook requirements](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

Proposed first reward: one small capped reward for a deliberate approved chat action from a linked participant, with per-user/world interval cap and source receipt. This is an economy decision awaiting approval. Store only required event fields; do not retain chat transcripts by default. Onboarding grants, if approved, must be labeled and posted from issuance accounts. Application points are separate from Twitch Channel Points/Bits. No paid advantage or subscription rewards initially; no silent-viewer or nationality inference. A simpler live-event celebration can prove Twitch integration without issuing points, while contributions use clearly labeled approved starter funds.

## Extension constraints

Separate lightweight bundle, no Pixi import. Responsive progress card/balance/action/receipt; disabled writes during unlinked/expired/offline state. Helper first script; submitted front-end assets bundled locally; no nested iframe, eval-dependent code or arbitrary remote scripts. Register API/media allowlist domains and review actual CSP behavior. Test mobile portrait/landscape in Twitch, not only a desktop iframe.

Published policy lists mobile initial load <=1 MB and <3 s at approximately 500 Kb/s, as well as old mobile OS floors. At that rate, a full 1 MB would exceed the time budget: target much smaller (candidate <=150 KB compressed first payload), then measure. Modern Tailwind v4 lists Safari 16.4+, Chrome 111+, Firefox 128+; that is not equivalent to Twitch's stated mobile minimums. Choose a conservative dedicated CSS/build target after actual runtime review. [Extension policy](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/), [Tailwind compatibility](https://tailwindcss.com/docs/compatibility).

Public Extension availability is not a November 2 prerequisite. Local/Hosted Test restrict visibility; document tester accounts/state honestly. Current expected review time is 8–14 days. Keep API compatibility for old clients during version transition. Provider lifecycle and guideline wording on review-channel availability differ; use the applicable review instructions and confirm with Twitch before a public submission. [Lifecycle](https://dev.twitch.tv/docs/extensions/life-cycle).

## Trust and moderation matrix

| Actor / input | Allowed | Never trust |
|---|---|---|
| Visitor | Public snapshots/history with privacy projection | Claimed identity/permission, hidden member data |
| Member | Approved appearance, own account contribution, permitted tasks | Posted balance, client time, arbitrary footprint or completion |
| Steward/moderator | Scoped placement/project moderation/member policies | A broad Twitch role as automatic game/database admin |
| Simulation worker | Specific scheduled effects with rules/resource bounds | Universal administrator permission or unbounded elapsed time |
| Twitch adapter | Authenticated, deduped source events -> reviewed rules | Chat text as privileged command/instruction; unsigned payload |
| Uploaded content | Quarantined immutable candidate after bounds/rights validation | Executable SVG/scripts/HTML, remote fetch URLs, archive paths, AI moderation verdict alone |
| Self-host/federated instance | Its local world only; future opt-in signed directory claim | Claimed remote balances, identities, moderation or asset safety |

Apply server-side capability checks in all adapters, tenant-scoped queries/FKs, body limits, rate limits by principal/world/IP, CSRF on cookie mutations, socket Origin checks and explicit CORS for approved surfaces. Auth renewal must reach long-lived sockets. Content names are escaped; allowlist media origins; no unrestricted URL fetch/SSRF. Secrets never enter Vite public environment variables. Audit sensitive grants and moderation with consent-aware attribution. Session disconnect is not deletion of community property; retention, anonymization and shared-work attribution need an explicit product/privacy policy.

UGC release path later: private draft -> size/format/rights validation -> isolated preview -> human scoped moderation -> immutable publication -> reporting/quarantine/appeal. Quarantine swaps a safe placeholder without deleting historical contributions. No UGC upload service is needed for the first slice; approved bundled assets reduce initial exposure. Specify backups, deletion/anonymization and logs retention before public onboarding.

## Deployment topology

Self-host first: TLS reverse proxy -> static web/overlay + Node API/WebSocket; same image worker mode; PostgreSQL private volume; bundled immutable assets with optional filesystem storage. Configure Twitch app/redirect, encryption key, database, public origin, session key and admin bootstrap through untracked environment/secrets. No default admin password, demo bypass or exposed database port in production. Migrations are an explicit one-shot step; readiness checks validate schema, worker lease progress and database availability. Compose provides reproducible services when Docker is available.

Hosted mode: same application image and contracts; managed PostgreSQL with backups, object storage/CDN, TLS/long-lived socket capable container host, worker replica limits and tenant quotas. Shared database does not imply unrestricted cross-community reads. Start single region; no provider chosen or paid resource approved. Public static frontend hosting alone cannot host a durable scheduler or the complete socket backend. Review cost ceiling, egress/asset costs, judging availability and restore plan before deployment.

Reliability: graceful socket drain, bounded database pool, request/lock timeouts, outbox/inbox age metrics, scheduler lag, readiness/liveness separation, structured redacted logs/correlation IDs, and encrypted backups with restore rehearsal. Proposed initial recovery targets: RPO <=24 h for a small self-host backup schedule, RTO <=1 h after backup availability; hosted targets depend on approved provider/PITR budget. These are planning targets, not achieved service levels. Retain database and referenced asset manifests together.

OBS: a normal browser-source page with transparent background and read-only progress stream. Reconnect independently, tolerate hidden-source reload and test at actual stream resolution/frame rate. No OBS WebSocket plugin or control permissions needed for display. [OBS browser source](https://obsproject.com/kb/browser-source).
