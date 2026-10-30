# Draft domain and command contracts

**WF-01 refinement:** Proposed v2 world contracts (internal source record omitted) cover certified founding geography, typed spatial state, topology races, public/private cursors and explicit v1 coexistence. They do not alter current executable contracts or approve the earlier economy/membership proposals below. Review decisions (internal source record omitted) precede implementation.

Status: engineering refinement of Drive schema v0.3, updated 2026-10-28 after user review. Scoped project/resource-account concurrency, persisted generated content/version compatibility, and explicit relational contracts for critical resources/permissions/projects are adopted design constraints. The physical schema, lock algorithm, wire API and economy semantics below remain proposed and unimplemented. Flexible components are reserved for appropriate versioned noncritical data.

## Initial relational shape

New architectural direction: Building Genome (internal source record omitted) separates a versioned resolved appearance recipe and render bundle from authoritative footprint/entrance/collision/navigation and relational ownership/permissions. Future module/style/customization JSON cannot redefine those critical fields. Persistent appearance/upgrade commands and migrations require separate review; no executable schema is changed by this addition. ADR-0003 (internal source record omitted) distinguishes requested long-term intent from proposed mechanisms.

Use UUID/internal IDs and opaque provider subject strings. IDs never imply authority. All world-scoped relationships must carry matching world/community scope, enforced by composite unique keys and foreign keys where possible.

| Aggregate / tables | Minimum fields and constraints |
|---|---|
| Person, ExternalAccount | Person id/status/preferences; external `(provider, provider_subject)` unique, user FK. Linking requires proof of both accounts; never merge by display name/email. |
| Community, Membership, RoleGrant | Immutable identity; creator connection separate from steward; `(community,user)` unique membership; capability + target scope + revocation/version. Ban overrides member grants. |
| World, WorldChunk | One world per community initially; seed/generator/rules/schema/manifest versions, event sequence and simulation watermark. Chunks keyed by world/x/y with persisted base and mutations. |
| WorldEntity, Plot | World/id, kind, quantized position/elevation, orientation, footprint version, recipe hash, lifecycle, owner/plot and revision; same-world FKs. Plot policy and zone version validated in transaction. |
| Character, CharacterPresence | Global optional person-owned identity; per-world profile/home/consent/task state and revision; unique character/world. NPC identity explicitly distinct. No record for every follower. |
| Project | World/id/target entity, planned/building/completed/cancelled state, integer requirements/funded totals, revision, completion policy. Enforce funded within approved requirement. Construction completion and funding completion are distinct transitions. |
| EconomicAccount, LedgerTransaction, LedgerEntry | World/owner/resource unique account, cached integer balance and version; signed entries grouped by transaction, balanced per resource including issuance/burn treasury accounts. Participant account may not become negative. Currency name is not Twitch Channel Points. |
| Contribution | Project/actor/command/resulting journal reference, exact accepted amount, attribution preference/time. Unique scoped command reference. No mutable donation history. |
| CommandReceipt | `(principal_id, world_id, command_id)` unique, request hash/type/schema and durable response. Same key with changed payload fails; same request returns original result. CreateVillage uses a creator-scoped key before world exists. |
| ExternalEventReceipt / Inbox | Provider, application/subscription identity, provider event ID unique, schema/type, received/occurred times, minimal payload and processing state. Receipt and reward must not be split by a crash. |
| ScheduledAction | World/type/due time/payload/version, generation/idempotency key unique, pending/leased/completed status, lease expiry and attempt. Bounded retry/dead-letter path. |
| WorldEvent, OutboxEvent | `(world,sequence)` unique; immutable event id/type/schema/payload/causation/actor/time. Outbox references event, publication attempts/lease/time. Public projections exclude private payload fields. |
| AssetDefinition / ModerationReview | Immutable published version/hash, source/rights/author, dimensions/anchors/footprint/nav/LOD and moderation state. Draft and published versions distinct. Quarantine does not remove transaction history. |

Use typed columns for ownership, resource amounts and lifecycle, not arbitrary component JSON. JSON may hold validated versioned trait/appearance data. SQL checks cannot alone enforce the sum of ledger entries: enforce via one transactional posting service plus constraints/deferred validation and reconciliation tests. PostgreSQL bigint amounts serialize as decimal strings; browser payloads must not silently lose precision. Ban zero/negative/overflow contributions and unsupported resource types.

## Wire commands

Illustrative envelope (the actor is deliberately absent):

```json
{
  "commandId": "opaque-unique-id",
  "worldId": "world-id",
  "schemaVersion": 1,
  "kind": "ContributeToProject",
  "payload": {"projectId": "project-id", "resource": "community_point", "amount": "10"},
  "expectedProjectRevision": 7,
  "clientSentAt": "2026-10-28T12:00:00Z"
}
```

Principal, scopes, role and current grants come from server authentication, not body fields. Client time is advisory. For additive contributions, omit expected revision unless the user explicitly acts on a quoted condition; under lock check current eligibility and remaining requirement. PlaceStructure/appearance edits use relevant target/policy revisions. No global-world stale check for every small action.

Outcomes: `committed` with receipt/revisions/sequence and accepted amount; `duplicate` with original receipt; `invalid` with stable code; `unauthorized`; `conflict` with safe current refs; `retryable` with retry guidance. Transport mapping proposed: success 200/201; malformed 400; unauthenticated 401; forbidden 403; conflict/id reuse 409; domain validation 422; rate limit 429; temporary unavailable 503. Avoid leaking the existence of inaccessible worlds through error details.

Initial commands by slice: CreateVillage, JoinVillage, ChangeAppearance, ContributeToProject, PlaceStructure (steward approved templates only), AdvanceScheduledAction (internal), RecordTwitchActivity (internal). AssignCharacterTask and ApproveCommunityAsset belong only when their associated systems are built. An HTTP route for internal commands is not automatically public.

## Contribution transaction algorithm

1. Authenticate, rate-limit and runtime-validate; resolve world/community permission scope. Begin transaction. Establish receipt key atomically; concurrent duplicate waits for winner or retries after rollback. Compare request hash. Store successful receipt and response in the same transaction as state. Version/validate durable rejection caching separately; never let a transient denial permanently poison a reusable intent.
2. Lock relevant membership/policy, then project, then all affected economic accounts sorted by ID, using the same lock order for all command handlers. Recheck authorization, status and balances while locked. Revoke/ban paths use the same authority lock/version discipline.
3. Proposed overfunding rule: reject the entire contribution if it exceeds remaining requirement; return current remaining amount. No silent clamping. Product owner must approve this behavior. Validate positive bounded integer amount and nonnegative spendable account balance.
4. Post balanced journal entries; update account balance, project totals/state and contribution attribution atomically. If fully funded, schedule one versioned completion using a unique key. Do not complete twice from competing last contributions.
5. Acquire world stream counter last, increment by event count, append events/outbox, finalize receipt and commit. Every command follows this order. Bound lock waits; retry deadlock/serialization failures with jitter and the same command ID. No outside network effects before commit.
6. Return durable receipt even if publication is delayed. Publisher delivers at least once; marking published can fail after send. Consumers deduplicate by event ID/sequence. Keep private ledger/account fields out of public world messages.

Alternatives: serializable transactions with bounded retries reduce some manual checks but can increase hot-world retries; a per-world actor loop is simpler locally but cannot replace database concurrency controls across restarts/processes. Start with explicit locking and measured contention, then revisit. [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).

## Multiplayer recovery

- Read snapshot and high-water cursor in one consistent database snapshot. Use opaque public stream generation/cursor plus schema version; entity revision is a different number.
- Subscribe with last applied cursor. Register/buffer live updates before replay, replay durable events through a captured high-water mark, then drain buffered events in sequence with deduplication. This closes the snapshot/subscribe race.
- Full-world public stream initially. On interest filtering, send cursor-advance envelopes or a separate subscription cursor contract; otherwise omitted offscreen events look like gaps.
- Ignore old duplicates; buffer a small out-of-order window; on unresolved gap fetch replay. If cursor expired, incompatible schema or buffer cap reached, replace with a new snapshot. No infinite replay buffer.
- Pending UI contribution uses command ID. After timeout query/retry the same ID rather than creating a second payment. Never optimistic-debit an authoritative balance permanently.
- Heartbeats and idle timeouts; bounded messages, backpressure/coalesced snapshots and reconnect jitter. Slow client disconnected with resumable cursor. Reauthenticate/recheck grants after revocation and subscription changes.
- Outbox may be republished after crash; world events retained for a declared replay horizon. History retention is a separate privacy/product policy. Snapshots plus database backups are the recovery basis, not the socket stream.

## Time and inhabitants

Server clock and stored simulation watermark determine progression. Due actions claim short leases with `FOR UPDATE SKIP LOCKED` candidate strategy; domain effect and completed marker commit together. Expired leases retry safely. Stable due-time/action-ID ordering and versioned rules; one consequential reconciliation writer per world. Cap work by elapsed time and action count per run, continue later with visible pending catch-up.

Use analytic accumulation between meaningful deadlines instead of replaying every tick. Bound accrual and reviewed catch-up horizon; reward/economy caps need approval. Clock rollback never reverses committed effects. User-selected commitments outrank ambient utility choices. Utility scoring uses finite candidates, cooldown/hysteresis and separate deterministic random streams. The FSM executes bounded tasks and handles unavailable destinations. Persist job/task milestones; do not journal footstep frames or infer real social relationships.
