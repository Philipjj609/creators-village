# WF2 exact persistence and spatial contract — specification only

## Authorized implementation clarification: authentication flights

WF2's E09 cross-process refresh race requires an authentication-only lease, in addition to per-process coalescing. Add nullable `sessions.validation_lease uuid` and `sessions.validation_lease_until timestamptz` in additive migration005, fenced by the existing encrypted-token generation. A30-second lease is acquired/released in short SQL statements; no PG connection/gameplay lock is held during Twitch calls. Competing processes wait boundedly/re-read fresh state. Persist rotated tokens before remote validation while preserving the old validation timestamp; a provider outage must not discard the new refresh token or extend authorization freshness. Successful/definitive-failure writes compare both lease and token generation. Expired/revoked sessions cannot be revived. This is an ordinary implementation refinement under project owner's WF2 authorization, with no identity/scope/privacy/economy change. Preflight compares existing columns excluding these additive nullable flight fields.

2026-10-29, v0.17. Approved product rules: [ADR-0006](../decisions/0006-wf2-private-playtest-policy.md). This specifies the next additive migration; it is **not SQL applied to a database**, and no schema test has run. [Commands](wf2-command-contract.md), assignment (internal source record omitted), acceptance (internal source record omitted). Preserve terrain format2/profile `gentle-512-32-2` and every saved baseline byte/hash; add current-state schema `wf2-state-1` separately.

## Notation and common rules

Each definition below is normative: all fields NOT NULL unless suffixed `?`; `uuid`, `text`, `integer`, `bigint`, `boolean`, `timestamptz`, `bytea`, `jsonb` are PostgreSQL types. Revisions/epochs/cursors are bigint>=1 and transport as decimal strings; work counts are bounded integers, not money. All timestamps are server UTC. UUIDs come from the server except client command IDs. Hex digest fields are text with `^[0-9a-f]{64}$`; tokens never appear in logs/replay. JSON is allowed only for validated versioned geometry, safe projection payloads and private receipt results, not ownership/capability/count authority.

PK/FK/unique/check/index clauses are mandatory. FKs are immediate/non-deferrable with NO ACTION deletion by default; no history cascades. Foreign IDs never grant authority. Composite FKs must preserve world/community scope. Ordinary application code cannot delete contribution/receipt history, reassign creator/world or edit an immutable ruleset/published plan. Migration scripts must implement the listed database triggers; cross-row counts/connectivity remain transactional service checks, not misleading arbitrary cross-table CHECKs.

## Existing tables: exact additive changes

- `people`: add nullable `twitch_login text` for the canonical login returned by the existing validated profile call. Populate at that person's next verified sign-in/validation, not through follower scans. Existing IDs/subjects/display names untouched. Login/display name are private approval metadata, not unique authorization keys.
- `oauth_states`: add nullable `join_continuation_id uuid` FK to the continuation table below. Only a server-resolved same-origin join continuation is resumed; existing null-context creator sign-in is unchanged.
- `founding_worlds`: add UNIQUE `(id,creator_id)` for a scoped FK; retain creator, purpose, header/baseline hash, topology_epoch/public_cursor. No ready-world/slot changes. The existing world row remains the short publication head; a separate topology-lock row below prevents long spatial work pinning it.
- `founding_structures` and `founding_paths`: retain schema/rows and accept additional validated workshop/path IDs through WF2 services. The founding shelter/path remain byte-for-byte equivalent. No new individual ownership field: the shared workshop belongs to the existing community/world.
- Keep `founding_occupancy` unchanged as the WF1 founding record. On opted-in mutable-state activation copy its24 claims exactly into the new authoritative current claim table; never alternate between two writable claim sources. WF2 writes only current claims. Old construction writers do not exist; old incomplete readers fail explicitly.
- `worlds`, `create_receipts`, `world_events`, `founding_jobs`, original migrations and creation receipts retain their current behavior. RG1/RG2 are not folded into this assignment.

## New tables and exact keys

### Rules, binding and authority

```text
wf2_rulesets
  id text PK; goal integer CHECK 1..100; minimum_non_creator integer CHECK 0..goal;
  max_non_creator_members integer CHECK 1..1000; max_active_projects integer CHECK 1..100;
  template_id text; policy_hash digest; schema_version integer CHECK =1
  UNIQUE(id,goal,minimum_non_creator)
  Seed exactly cp1-wf2-test-1 = (goal2, minimum_non_creator1, max_members8,
    max_active1, template wf2-workshop-1). UPDATE/DELETE prohibited.

wf2_communities
  id uuid PK; creator_id uuid UNIQUE FK people(id); created_at timestamptz
  UNIQUE(id,creator_id)

wf2_bindings
  world_id uuid PK; community_id uuid UNIQUE; creator_id uuid;
  ruleset_id text FK wf2_rulesets(id); state_schema text CHECK ='wf2-state-1';
  enabled boolean; authority_epoch bigint; credit_revision bigint;
  replay_floor bigint CHECK >=0; activated_at timestamptz
  UNIQUE(world_id,community_id)
  FK(world_id,creator_id) -> founding_worlds(id,creator_id)
  FK(community_id,creator_id) -> wf2_communities(id,creator_id)
  Application activation additionally requires purpose=development and configured approved world.

wf2_topology_guards
  world_id uuid PK FK wf2_bindings(world_id)
  This is a lock sentinel only; authoritative epoch stays founding_worlds.topology_epoch.

wf2_memberships
  id uuid UNIQUE; community_id uuid; person_id uuid FK people(id);
  state text CHECK IN(pending,active,left,banned,rejected); revision bigint;
  created_at timestamptz; changed_at timestamptz
  PK(community_id,person_id); FK community_id -> wf2_communities(id)

wf2_world_grants
  world_id uuid; community_id uuid; person_id uuid;
  can_view boolean; can_contribute boolean; revision bigint; revoked_at timestamptz?
  PK(world_id,person_id)
  FK(world_id,community_id) -> wf2_bindings(world_id,community_id)
  FK(community_id,person_id) -> wf2_memberships(community_id,person_id)
  CHECK(NOT can_contribute OR can_view)
  CHECK(revoked_at IS NULL OR (NOT can_view AND NOT can_contribute))
```

One binding is intentionally one configured development world/community in this test; it is not a migration of the active v1 community or a universal account/world limit. Activation creates creator membership/grant and guard atomically. No owner transfer endpoint. Non-creator admission count<=8 is checked under the binding authority guard, excluding the existing creator; a ban/leave releases membership capacity. Creator cannot leave/ban themselves through cohort commands.

### Request links and admission

```text
wf2_invitations
  id uuid PK; world_id uuid FK wf2_bindings(world_id);
  issued_by uuid FK people(id); token_hash digest UNIQUE;
  sealed_token bytea?; created_at timestamptz; expires_at timestamptz;
  consumed_request_id uuid? FK wf2_join_requests(id); revoked_at timestamptz?
  CHECK(expires_at = created_at + interval '24 hours')
  CHECK(consumed_request_id IS NULL OR sealed_token IS NULL)

wf2_join_continuations
  id uuid PK; cookie_hash digest UNIQUE; invitation_id uuid FK wf2_invitations(id);
  expires_at timestamptz; completed_request_id uuid? FK wf2_join_requests(id)
  No plaintext invitation token or world-read capability; bounded opaque join resume only.

wf2_join_requests
  id uuid PK; revision bigint; world_id uuid; community_id uuid; person_id uuid;
  invitation_id uuid UNIQUE FK wf2_invitations(id);
  state text CHECK IN(pending,approved,rejected,withdrawn);
  created_at timestamptz; decided_at timestamptz?
  FK(world_id,community_id) -> wf2_bindings(world_id,community_id)
  FK(community_id,person_id) -> wf2_memberships(community_id,person_id)
  UNIQUE(world_id,person_id) WHERE state='pending'
```

Generate256-bit random tokens; persist hash plus an encrypted temporary copy so only the creator can retrieve an unused link until expiry. Reuse existing encrypted-secret infrastructure with purpose separation, never store plaintext token in a durable receipt. Consumption is at the authenticated **explicit request action**, not GET/preview/OAuth redirect; link scanners cannot grant access or consume it. Request insertion/token consumption/membership pending/receipt commit together. Erase sealed copy on consume/revoke/expiry. Retain minimal token-hash/ID linkage for audit/idempotency; it grants no read rights.

OAuth continuation is a bounded same-origin join route, bound to random OAuth state/server continuation, never an arbitrary redirect URL. Accept the invitation in a fragment then protected POST/no-referrer handling; do not forward it to Twitch or log it in request URLs. Signing in never automatically submits a request or creates a village. Show the currently verified account before the explicit request.

### Plans, work and spatial effects

```text
wf2_projects
  id uuid PK; world_id uuid; community_id uuid; created_by uuid FK people(id);
  ruleset_id text; goal integer; minimum_non_creator integer;
  state text CHECK IN(draft,open,ready,blocked,completed,cancelled);
  revision bigint; plan_revision bigint; plan_hash digest;
  template_id text CHECK ='wf2-workshop-1'; orientation integer CHECK =0;
  qx integer; qy integer; base_height integer; width_q integer CHECK =1536;
  depth_q integer CHECK =1536; entrance_qx integer; entrance_qy integer;
  path_points jsonb; path_width_q integer CHECK =384;
  geometry_schema text CHECK ='wf2-plan-1'; appearance text;
  asset_manifest_hash digest; created_at timestamptz;
  published_at timestamptz?; completed_at timestamptz?; cancelled_at timestamptz?;
  accepted_count integer DEFAULT0 CHECK 0..goal;
  non_creator_count integer DEFAULT0 CHECK 0..accepted_count;
  blocked_code text?
  UNIQUE(world_id,id); UNIQUE(world_id,id,community_id)
  FK(world_id,community_id) -> wf2_bindings(world_id,community_id)
  FK(ruleset_id,goal,minimum_non_creator) -> wf2_rulesets(id,goal,minimum_non_creator)
  UNIQUE(world_id) WHERE ruleset_id='cp1-wf2-test-1' AND state IN(open,ready,blocked)
  INDEX(world_id,state,id)

wf2_contributions
  id uuid PK; world_id uuid; project_id uuid; community_id uuid;
  person_id uuid; amount integer CHECK =1; command_id uuid; accepted_at timestamptz
  UNIQUE(world_id,project_id,person_id); UNIQUE(person_id,command_id)
  FK(world_id,project_id,community_id) -> wf2_projects(world_id,id,community_id)
  FK(community_id,person_id) -> wf2_memberships(community_id,person_id)
  INDEX(person_id,accepted_at,id)

wf2_claims
  world_id uuid; surface text CHECK ='ground'; hx integer; hy integer;
  kind text CHECK IN(reserved,solid); project_id uuid?; structure_id text?
  PK(world_id,surface,hx,hy)
  CHECK((kind='reserved' AND project_id IS NOT NULL AND structure_id IS NULL)
     OR (kind='solid' AND structure_id IS NOT NULL AND project_id IS NULL))
  FK(world_id,project_id) -> wf2_projects(world_id,id)
  FK(world_id,structure_id) -> founding_structures(world_id,id)
  INDEX(world_id,project_id); INDEX(world_id,structure_id)

wf2_completion_jobs
  world_id uuid; project_id uuid; plan_hash digest;
  status text CHECK IN(pending,leased,blocked,done,cancelled);
  lease_token uuid?; lease_until timestamptz?; attempt integer CHECK >=0;
  next_attempt_at timestamptz; error_code text?; updated_at timestamptz
  PK(world_id,project_id); FK(world_id,project_id) -> wf2_projects(world_id,id)
  INDEX(next_attempt_at) WHERE status IN(pending,leased)

wf2_completion_results
  world_id uuid; project_id uuid; structure_id text; path_id text;
  committed_cursor bigint; completed_at timestamptz
  PK(world_id,project_id); UNIQUE(world_id,structure_id); UNIQUE(world_id,path_id)
  FK(world_id,project_id) -> wf2_projects(world_id,id)
  FK(world_id,structure_id) -> founding_structures(world_id,id)
  FK(world_id,path_id) -> founding_paths(world_id,id)
```

Published plan fields (ruleset, goal/minimum, pose/envelope/height/entrance, route/width, geometry schema, asset/hash, creator permit) are immutable once `published_at` is non-null, including at zero work. A DB trigger rejects changes; lifecycle/revision/count/blocked fields are the only mutable project fields. Draft cancellation need not have published_at; open/ready/blocked/completed must. Completed/cancelled are terminal; no complete->cancel path. Contributions cannot be updated/deleted, moved or invalidated in CP1. Cached counts reconcile to immutable contribution rows; server services enforce counts plus threshold under project lock. No membership deletion cascades through accepted work.

Drafts reserve no cells and do not consume the active-slot index. Publishing inserts reserved claims; actual navigation uses solids, while future-placement validation treats reserved footprints as potential solids. Paths/aprons are separate derived corridors checked against occupancy and other plans; a road cell is not universally an exclusive solid cell. Cancel removes only its reservations and fences its job. Complete inserts deterministic IDs `wf2-workshop-<projectUUID>` and `wf2-path-<projectUUID>`, converts its reservations to those solid claims and inserts the unique result in one transaction. Baseline/tree flags/heights and founding facts never change.

### Receipts, recognition, replay and logs

```text
wf2_command_receipts
  person_id uuid FK people(id); command_id uuid; command_schema text;
  kind text; target_world_id uuid? FK founding_worlds(id); request_hash digest;
  result jsonb; created_at timestamptz
  PK(person_id,command_id)
  Original accepted result immutable; no token, name snapshot or future mutable status embedded.

wf2_credit_consents
  world_id uuid; project_id uuid; person_id uuid;
  opted_in boolean DEFAULT false; revision bigint; changed_at timestamptz
  PK(world_id,project_id,person_id)
  FK(world_id,project_id,person_id) -> wf2_contributions(world_id,project_id,person_id)

wf2_shared_batches
  world_id uuid FK wf2_bindings(world_id); cursor bigint; batch_id uuid UNIQUE;
  batch_schema text CHECK ='wf2-batch-1'; payload jsonb;
  committed_at timestamptz
  PK(world_id,cursor); INDEX(world_id,committed_at,cursor)

wf2_outbox
  world_id uuid; cursor bigint; state text CHECK IN(pending,leased,notified);
  lease_token uuid?; lease_until timestamptz?; next_attempt_at timestamptz;
  attempt integer CHECK >=0
  PK(world_id,cursor); FK(world_id,cursor) -> wf2_shared_batches(world_id,cursor)
  INDEX(next_attempt_at) WHERE state IN(pending,leased)

wf2_operational_logs
  id bigint GENERATED ALWAYS AS IDENTITY PK; at timestamptz;
  code text; duration_ms integer?; retry_count integer?; world_id uuid?
  No freeform payload, identity, token, URL, IP, name or seed columns.
  INDEX(at)
```

Consent scopes this project **and its resulting building**, no future projects. Current display derives only from opted-in accepted contributors and current allowed profile label; no cached name in events/receipt history. Withdrawal/leave/ban suppresses credit, increments credit_revision and emits a safe invalidation; work counts/results unchanged. No automatic opt-in restoration after rejoin. Enabling named credit requires current membership/grant; disabling can use the authenticated own-receipt privacy route without world access.

Sanitized application-managed operations logs expire at14days; cleanup is batched hourly and exposes a health warning if it cannot run. Operator-controlled external terminal/archive copies are not represented as universally erasable app storage. Shared replay prunes a complete prefix older than7days or beyond10,000 batches, advances replay_floor atomically, and deletes dependent outbox rows. Retained current snapshots are the recovery source; an offline client below the floor bootstraps, not replays a contribution. Notify state never means every client received a batch.

Minimal contribution/receipt/eligibility/ban records persist for project/world life while those records exist, to preserve accepted facts and prevent rejoin replay. No API cascades account deletion into history. Names/consent are separate; account-wide deletion/export/escalation is an explicit administrative review process, not a promised universal delete feature. State these limits before admission. No arbitrary text/messages/upload content in WF2.

## Exact ws1 spatial profile and plan codec

`wf2-workshop-1` has fixed orientation0 (matching the retained45°/30° source), center(qx,qy) on128-unit half-tile grid; conservative6×6-tile envelope `[qx-768,qx+768) × [qy-768,qy+768)`. Ground corner samples under the envelope must be equal integers; base_height is that sample in1/16-tile units. Entrance `(qx,qy+896)` is half a tile in front of the envelope; protected apron width384/depth256 centered on that entrance. All footprint/apron/route half-cell corners must be inside the active circle, dry, obstacle-free and supported; no grading/clearing. Reject overlap with founder/other solids/reservations/protected entrances/initial path. The existing source includes canopy poles and stored timber beyond its body; audit the full source envelope before enabling publication. If it does not fit this conservative profile, stop with evidence; do not shrink claims to match a pretty sprite.

Appearance is `hearthside-hero-01/workshop` with stored manifest SHA256, overview/focus from the same unchanged geometry/materials. Verify pivots/axes rather than reuse v1 elevation indexes. A footprint is not taken from alpha pixels.

Connecting path width384Q (1.5tiles), endpoints existing founding-path end `(0,2304)` and the new entrance. Derive a four-neighbor half-grid path with deterministic A* tie order N,E,S,W and stable cost/index ties; validate the full swept corridor/entrance against terrain and claims, simplify only collinear segments, store exact integer `{qx,qy}` points. At most256 points; no diagonal corner cutting or implicit bridge. Revalidation never silently reroutes a published plan. If no route exists, no publish.

Plan digest uses a versioned named-field descriptor: `geometry_schema,world_id,baseline_hash,ruleset_id,goal,minimum_non_creator,template_id,orientation,qx,qy,base_height,width_q,depth_q,entrance_qx,entrance_qy,path_width_q,path_points,appearance,asset_manifest_hash`. Integers only, NFC strings, exact point order; SHA256 of the explicit serialized field sequence. Never hash arbitrary JSONB object iteration order. Codec and profile are WF2 test inputs, not a general procedural builder.

## Migration and compatibility gate

No executable migration is created here. Implementation prepares a new additive migration and tests it on a restored copy before live opt-in. No old migration edits/checksum changes, v1 conversion or current-world overwrite. Activate binding/claim copy in one transaction only for the configured existing private v2 owner; verify24 copied founding claims and original baseline/founder/v1 hashes. New current-state API advertises `wf2-state-1`; legacy v2 full-world reader returns409 `CLIENT_UPDATE_REQUIRED` once that world is enabled, rather than silently omitting later buildings. Keep explicit world URL/ID. V1 readers/receipts remain valid; RG2 retirement is not applied. Rollback disables WF2 writes and fails old mutable reads safely, retaining new facts for forward recovery; no destructive down migration.
