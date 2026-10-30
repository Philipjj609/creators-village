# WF2 exact HTTP, command, transaction and stream contract

## PI1 additive product readers (implementation authorised)

`GET /api/worlds/:id/entry` returns a minimal version/reader/name/capability descriptor only after the existing world read policy succeeds. Existing legacy and founding readers remain unchanged. Enabled mutable worlds never fall back to founding-only data. `GET /api/communities` is authenticated and returns only the creator's existing worlds and the caller's explicit active grants (paged); joined worlds are not represented as follows. No provider IDs, roster, live claims or new grants. Creation availability reflects existing slot/private-playtest policy, not a new creation permission. Contracts are executable in `product.ts`.

Follow discovery remains `not-connected`: current OAuth requests an empty scope; official Get Followed Channels needs `user:read:follows`. PI1 adds no scope or arbitrary followed creators. No new schema/migration, economy or privacy disposition.

## Implementation clarifications under the approved assignment

The authoritative executable command and strict projection schemas live in `packages/contracts/src/participation.ts` and `participation-wire.ts`. Profile2 dimensions in its reader are compatibility/version checks, not permanent product limits. JSONB key ordering uses explicit UTF-16 key ordering, integer values and NFC strings; UUID input is canonical lowercase. A current bootstrap verifies the saved baseline descriptor against all256 retained chunk hashes; active spatial work additionally decodes and verifies chunk bytes. Unsupported/corrupt data fails without regeneration. Repeatable Read snapshot acquisition retries serialization races boundedly.

`GET /api/wf2/me` returns own scoped grants, up to20 own request references `{requestId,state,worldId}` and up to20 own contribution references `{commandId,projectId}`. These authenticated own-context IDs enable pending-request withdrawal and private receipt/credit controls after access loss; they grant no map access and expose no other member/provider identity. The anonymous continuation initializer still returns no world ID. An already-false recognition withdrawal is a private no-op receipt, with no shared cursor/credit change. Draft cancellation remains creator-private even in bootstrap/direct project reads. Consent controls default off independently for each new project.

Native stream sockets are closed on shutdown; a lost HTTP acknowledgement recovers through the original durable receipt. Authentication-only migration005 leases coalesce refresh across processes without holding gameplay connections/locks during Twitch calls; rotated tokens survive a later validation outage. Each stream's provider flight is isolated so slow validation cannot block another member's revocation check. No scopes, account/ownership rules, economy or P1–P9 disposition change.

The shared-IP browser experiment exposed the original120/IP/minute budget starving legitimate cohort clients. WF2 now applies a600/IP/minute ceiling before session lookup, then120/verified-account/minute (or120/anonymous-IP/minute); public/legacy/auth routes retain120/IP/minute. Random cookie strings cannot create authenticated budget keys. These are bounded transport protections for the private test, separate from membership/contribution policy. Stream limits remain4/session and16/process. Recognition changes take the binding update guard to avoid lock upgrades; uncredited contributions use its share guard and do not acquire topology. More granular credit-version locking is deferred until the single-active-project test produces a measured need.

Supported startup/rollback uses the fingerprinted `scripts/start-server.mjs` interlock described in operations (internal source record omitted). It rejects pre-WF2 or mixed artifacts before importing an entrypoint once mutable bindings exist. Safe rollback keeps the new reader and disables writes; direct execution of an old WF1 entrypoint is unsupported and is not represented as database-fenced. Original headers/geography/receipts are not rewritten to force downgrade behavior.

2026-10-29, v0.17. **Prepared specification; implementation authorization pending.** [Accepted policy](../decisions/0006-wf2-private-playtest-policy.md), [exact persistence/spatial schema](wf2-schema-contract.md), assignment (internal source record omitted), tests (internal source record omitted). All errors/payloads below require strict executable schemas during implementation; they are not endpoints implemented by this document.

## Scope, identity and feature boundary

WF2 defaults disabled. Explicit owner activation binds only the privately configured existing v2 development UUID, with matching creator/purpose/baseline; it never creates a community-owned replacement world. Config values containing the private UUID live in ignored local configuration. No public cohort discovery, member roster, general grant editor, ownership transfer or arbitrary template endpoint. New member entry resumes joining, not founding another village.

The private-playtest entry points do not expose new creator onboarding; new unaccepted v2 founding requests are gated `ONBOARDING_CLOSED` while that playtest mode is enabled. Existing matching generation receipts/status/read access remain available. This is an onboarding gate, **not** RG1 recovery or RG2 retirement: do not change the legacy-v1 new-creation policy/receipts under this assignment. No public deployment or widening of current access occurs. Existing v1 and non-enabled WF1 reader behavior remains unchanged.

Use existing confidential-server Twitch code exchange and state/secure cookie protections. Validate user subject/client, fetch only current display name/canonical login necessary for approval; no email/follow/subscriber/mod/watch-time scope. Private approval DTO: requestId, revision, submittedAt, validated Twitch login/displayName; no raw subject ID/token/email. Ordinary members do not see that DTO or a roster. Stable internal `person_id` determines one contribution; a mutable display label never does.

Validate sessions at startup, before stale authenticated requests and every55minutes while streams exist, with a60minute maximum successful-validation age. Coalesce refresh/validation per session/token generation and fence stale results; never hold gameplay DB locks while calling Twitch. Definitive invalidation closes sessions/streams; transient outage cannot extend freshness indefinitely. Past deadline, pause authenticated commands/delivery until validated, keep committed work. No automatic anonymous fallback on the private world. Test startup/request/idle-stream/reconnect and refresh races with the real existing adapter plus isolated deterministic provider faults.

## Routes and exact envelopes

All `/api/wf2` responses: `Cache-Control:no-store`, strict same-origin credential handling; no permissive credentialed CORS. Unknown/inaccessible private world/entity reads return404 `NOT_FOUND`. Known own requests/receipts can be read through their specific authenticated routes without granting world access. Native SSE GET may omit Origin; validate same-origin fetch context/Origin when present and always require session+world grant. Authenticated unsafe methods require Origin and CSRF as existing production commands do. The sole pre-auth continuation initializer has no session authority: require exact Origin, JSON and a non-simple `X-WF2-Join:1` header, reject cross-site/CORS requests, and grant/consume nothing. Actual RequestJoin still requires the authenticated CSRF token and explicit account confirmation.

```text
POST /api/wf2/worlds/:worldId/commands
 {commandId: UUID, commandSchema:'wf2-command-1', kind:<allowlisted kind>, payload:<below>}
 POST activation also uses this route, creator-only and configured-world-only.

POST /api/wf2/join/continuations
 {token: 64 lowercase hex characters}
 -> {continuationId:UUID, expiresAt:ISO}; set opaque HttpOnly SameSite=Lax cv_join cookie.
 No access, membership or token consumption; no map/world ID returned.

POST /api/wf2/join/commands
 {commandId:UUID, commandSchema:'wf2-command-1',kind:'RequestJoin',payload:{continuationId:UUID}}
 Requires current authenticated account confirmation, CSRF and matching live cv_join context.
 Original matching receipt retry works after context cookie is cleared; it cannot consume twice.

GET /api/wf2/join/continuations/:id     current signed-in account + expiry/confirm state only
GET /api/wf2/join/requests/:id         own request/current eligibility; creator uses scoped list
GET /api/wf2/me                       own grants/request references, not other memberships
GET /api/wf2/worlds/:id/admission      creator only; pending requests/members paginated20/cursor
GET /api/wf2/worlds/:id/invitations/:inviteId/link
 creator only -> {url:'/join#request=<token>', expiresAt}; reveal only unused/unexpired link
GET /api/wf2/receipts/:commandId       own durable minimal result, no unrelated world payload
GET /api/wf2/worlds/:id/bootstrap      wf2-state-1 safe current projection at one cursor
GET /api/wf2/worlds/:id/events?after=<decimal>&limit=<1..200,default100>
GET /api/wf2/worlds/:id/stream?after=<decimal>   same-origin SSE, same replay contract
GET /api/wf2/worlds/:id/projects?state=draft&after=<opaque>&limit=<1..20>
 creator-private paginated drafts; member cannot request this list
GET /api/wf2/worlds/:id/projects/:projectId     current safe project/status
GET /api/wf2/worlds/:id/projects/:projectId/credits
 -> {creditRevision:decimal,credits:[{creditId:UUID,label:string}]} ; no global person/provider IDs
POST /api/wf2/privacy/commands         authenticated own receipt/credit context only
 {commandId,commandSchema,kind:'SetRecognition',payload:{projectId,optedIn:false}}
```

Invitation retrieval is deliberately separate from immutable receipt: `IssueInvitation` result holds inviteId/expiresAt, never the plaintext token. Store only an encrypted temporary copy for repeated creator retrieval until consumed/expired; erase it then. A token is not in a durable log/replay/receipt/redirect query. Request consumption locks the invite, creates the unique request/pending membership and original receipt atomically. Prefetch/GET does not consume. Reusing a token for another request returns409 `INVITE_USED`; stale/expired context returns410 `INVITE_EXPIRED`. A banned person cannot request through a fresh token until explicit unban. Return generic denial without leaking another requester's identity.

After sign-in, resume only a server-bound `/join` continuation attached to random OAuth state. Never accept an arbitrary return URL; no invitation token is sent to Twitch. Show “continue as this account” before RequestJoin. Existing no-context creator OAuth redirects retain their behavior. A participant need not create a village to join.

## Allowlisted commands

All object payloads reject additional fields. UUID is validated as UUID, not an arbitrary36-character string. QXY values are bounded integers on the128 grid; cursor/revision strings match `0|[1-9][0-9]*` and SQL bigint bounds. Client cannot supply role, person/creator IDs, amount, goal, topology epoch, asset URLs, footprint size, path points or completion state.

| Kind | Payload | Actor and precondition | Stable accepted result |
|---|---|---|---|
| EnablePlaytest | `{expectedBaselineHash:hex64}` | Existing configured private-world creator; feature permission; binding absent or identical | `{worldId,communityId,stateSchema:'wf2-state-1'}` |
| IssueInvitation | `{}` | Creator of enabled world | `{inviteId,expiresAt}`; exactly24h after issue |
| RevokeInvitation | `{inviteId}` | Same creator; unused or already revoked | `{inviteId,revoked:true}` |
| ApproveRequest | `{requestId,expectedRequestRevision:decimal}` | Creator; current request pending, not banned, capacity available | `{requestId,memberId,state:'active'}` |
| RejectRequest | `{requestId,expectedRequestRevision}` | Creator; current pending | `{requestId,state:'rejected'}` |
| LeaveCommunity | `{}` | Current non-creator member/requester | `{state:'left'}`; revoke grant/suppress credit |
| BanMember | `{memberId,expectedMembershipRevision}` | Existing creator; target is non-creator | `{memberId,state:'banned'}` |
| UnbanMember | `{memberId,expectedMembershipRevision}` | Existing creator; target banned | `{memberId,state:'left'}`; eligibility restored, no automatic access |
| CreateDraft | `{site:{qx,qy}}` | Creator; allowlisted ws1 plan derivable/valid | `{projectId,projectRevision,planRevision,planHash}` |
| ReviseDraft | `{projectId,expectedProjectRevision,site:{qx,qy}}` | Creator; state draft only | Same IDs/new revisions/digest; no reservation |
| PublishProject | `{projectId,expectedProjectRevision,planHash}` | Creator; valid draft/current quote, free active slot, reserve/access validation | `{projectId,state:'open',projectRevision,committedCursor}` |
| Contribute | `{projectId,planHash,recognitionOptIn:boolean}` | Active approved account+world grant; exact published plan; not previously accepted | `{contributionId,projectId,acceptedAmount:1,completionQueued:boolean,committedCursor}` |
| SetRecognition | `{projectId,optedIn:boolean}` | Own accepted contribution; enabling also needs current membership/grant; disabling needs only own authenticated context | `{projectId,optedIn,consentRevision}` |
| CancelProject | `{projectId,expectedProjectRevision}` | Creator; draft/open/ready/blocked, never completed | `{projectId,state:'cancelled',projectRevision}` |
| RetryCompletion | `{projectId,expectedProjectRevision,planHash}` | Creator; blocked; exact original plan | `{projectId,state:'ready',projectRevision}`; same job intent |

`RequestJoin` on the separate join route returns `{requestId,state:'pending'}` and consumes the link once. No other public command may create a membership/grant. Approve grants view+contribute for this world only; creator is not counted in the eight-member cap. Pending requests/drafts do not consume member/project active slots. Unban does not bypass normal request/approval; leaving requires approval again. Any unlisted kind, including InvalidateContribution, CompleteProject, ChangeGoal or TransferContribution, is rejected.

Duplicate accepted command with identical canonical input returns the original immutable result; different content under the same actor/ID is409 `COMMAND_ID_REUSED`. A new ID from a person already counted returns409 `ALREADY_CONTRIBUTED` plus own receipt reference, never another unit or implicit consent change. Consent is changed through its own command. Original receipts survive cancellation, expiry and replay retention; current status is a separate query. After losing world access, only a redacted own-receipt representation remains available; no private map/roster payload is returned. Receipt content stored in DB remains immutable.

Successful synchronous commands return200 `{commandId,status:'committed',result}`; internal completion is not a second client command. A committed `Contribute` may return completionQueued=true before worker completion; do not replace its stored response with future state. No-op idempotent replay is not another event. Errors use `{error:{code,retryable,requestId}}`:400 INVALID_INPUT/UNSUPPORTED_SCHEMA;403 AUTH_REQUIRED/FORBIDDEN/ONBOARDING_CLOSED;404 NOT_FOUND;409 STALE_TARGET/PLAN_CHANGED/ACTIVE_PROJECT_LIMIT/COHORT_LIMIT/ALREADY_CONTRIBUTED/TARGET_REACHED/PROJECT_NOT_OPEN/INVITE_USED/COMMAND_ID_REUSED;410 INVITE_EXPIRED;429 RATE_LIMITED;503 TEMPORARY_UNAVAILABLE. Typed compatibility response is409 CLIENT_UPDATE_REQUIRED. Error requestId is a safe diagnostic UUID, not a session/actor key.

## Linearization and lock order

Use one shared authority/transaction service for HTTP and workers; a route cannot bypass it. Before DB locks, authenticate/refresh/validate stale provider sessions, bound inputs, compute expensive preview and verify immutable asset catalog availability. Inside transaction, in this order:

1. Current session row share lock, then binding authority row share for ordinary actions or update for membership/access changes; verify existing creator/purpose/rules. Activation serializes on existing creator/person+world rows before the binding exists.
2. Relevant membership/grant rows in stable ID order (approval/cap/revoke also use binding update guard); receipt uniqueness for actor/command. Do not lock absent rows as if that prevented insertion; use existing binding sentinel and unique constraints.
3. For publish/reserve/cancel/complete only, lock `wf2_topology_guards`; then relevant existing chunk scope rows sorted `(y,x)`. Read/validate actual plus potential-reserved connectivity under this guard. Contributions never acquire it.
4. Lock project, then completion intent if needed. Recheck plan/state/counts/claims. Contribute inserts one immutable row, updates counters; if threshold2/non-creator1 satisfied, set ready and insert the unique job. It does not acquire topology after project lock.
5. Hold existing publication-head world row briefly **last**; update topology epoch only for spatial changes, increment safe shared cursor only if projection changes, insert atomic batch/outbox and original receipt; commit. No subsequent authority/project locks or external calls after taking the head.

Pure private admission/draft/denial changes do not increment the shared cursor. Credit suppression/change may legitimately change the visible credit revision, without exposing private reasons. Preview alone never reserves cells. CP1 eligibility is relative to the fixed original creator, not an inferred moderator role. Ban/revoke either occurs after an already-authorized commit or wins and denies the action. Accepted rows/counts do not get invalidated later; completion does not require past contributors to remain members. Creator permit and immutable plan must remain valid.

Revocation removes future view/contribute rights and suppresses current named credit; rejoin does not restore consent automatically. Own privacy withdrawal remains available. Cached UI flags cannot authorize work. No arbitrary per-world expected revision for contribution; only frozen planHash/current eligibility matter. SQL uniqueness is the double-effect backstop; graph validation is separate. Whole transaction retries use the same command ID, maximum3 attempts with bounded jitter for deadlock/serialization/lock-timeout only; all external effects occur after commit or through durable jobs/outbox.

## Internal completion transaction

One completion worker per process; jobs leased30s, one bounded validation/commit attempt<=10s, fresh lease UUID fencing checked under the locked intent row. Lease acquisition is a separate short transaction and is not held while acquiring authority/topology. A crash leaves a reclaimable lease; transient retries use1/2/4s backoff then show blocked. Missing support/asset/reference/state is blocked immediately with a safe code, not a new seed/plan. Creator RetryCompletion reuses the same plan/job; no progress loss. Stale leases cannot publish after cancellation.

Under the ordered locks above, require ready/exact plan, threshold met, reservations intact, current and reserved-future access valid, unchanged baseline/support, retained matching bundle. Insert deterministic workshop/path IDs, convert its reservations to solid claims, insert completion_result, set project completed/job done, release active slot and commit a **single** complete batch/receipt-independent current result. Failure at any step rolls back all spatial effects. Cancellation follows spatial order, sets cancelled/job cancelled and clears only its reservations; a completed project cannot be cancelled. No demolition, grading, alternate route, fake structure or retroactive fraud correction.

## Current-state and replay wire schemas

```text
GET bootstrap -> {
 stateSchema:'wf2-state-1',worldId,worldFormat:2,purpose:'development',baselineHash,
 baseline:<immutable WF1 manifest>,active:<unchanged WF1 mask>,
 cursor:decimal,replayFloor:decimal,topologyEpoch:decimal,creditRevision:decimal,
 structures:[{id,template,position:{qx,qy,height},footprint:{widthQ,depthQ},
              entrance:{qx,qy},appearance,assetManifestHash,revision:decimal}],
 paths:[{id,widthQ,points:[{qx,qy}],revision:decimal}],
 projects:[{id,state,planHash,planRevision:decimal,revision:decimal,goal,
            acceptedCount,nonCreatorConditionMet,template,site,path,blockedCode?}],
 currentChunkRevisions:[{x,y,revision:decimal}]
}
No private IDs, member list, names, invitations or command receipts.

Batch = {
 batchSchema:'wf2-batch-1',worldId,batchId:UUID,fromCursor:decimal,toCursor:decimal,
 changes:[<allowlisted project/structure/path upsert or project cancellation>],
 topologyEpoch:decimal,creditRevision:decimal,
 changedChunks:[{x,y,revision:decimal}]
}
Each committed shared batch advances cursor by exactly1; apply it atomically.
Kind allowlist: ProjectOpened,WorkAccepted,ProjectReady,ConstructionCompleted,
               ProjectCancelled,CompletionBlocked,RecognitionChanged.
Changes carry full safe current objects/revisions, never internal actor IDs/names.

GET events -> {batchSchema,fromCursor,toCursor,headCursor,replayFloor,batches:[Batch]}
after below replayFloor ->409 {error:{code:'RESET_REQUIRED',retryable:true}}
No event history means no resurrection/re-execution of commands.
```

Bootstrap uses one Repeatable Read snapshot for current facts/head/claim-derived state; pinned immutable terrain downloads can follow. Drafts are creator-private, queried separately and never smuggled into safe shared batches. The completed result/building can reference project ID for optional credit; no contributor identity is embedded in world geometry. Existing founding-event cursor1 is a baseline checkpoint; activation records replay_floor1 and begins WF2 safe batches at2 without rewriting it.

Renderer uses the same logical axes/camera/assets, full current structure/path arrays and changed-object/chunk invalidation. It may cull geography but must consume complete small-world batches regardless of camera. Pending contributions/ghost plans do not become buildings locally. A stale credit HTTP response cannot restore withdrawn names: fence by creditRevision/request generation and never advance world cursor from a credit-only read. Asset failure gives truthful fallback/Places, not a different recipe or lost state.

## SSE and delivery/recovery

SSE `id` is toCursor, `event: batch`, data is the exact Batch JSON; `event: reset` contains safe current head/floor and closes for bootstrap; `event: reauth` has no world details and closes. Native Last-Event-ID may resume only the same authorized world. Initial query after is used when no native last ID exists; malformed/future/unsupported cursors force safe bootstrap. No token in URLs. Heartbeat is a comment every10s and grants no progress; validate authorization before a batch/heartbeat.

Bound one stream/world/page, four streams/session,16 per process in the closed test; max event64KiB, per-stream queue256KiB or100 batches. Backpressure overflow disconnects to replay; it never grows unbounded or blocks commits. SSE clients hold no dedicated PostgreSQL connection; keep the existing bounded pool. One process poller every250ms batches its subscribed worlds, rechecks DB authority epochs, and reads the durable log; PG notifications/outbox are wake hints only. A globally notified outbox row is not proof all nodes/clients received it. New nodes recover from the log, not memory. Do not add Redis or a WebSocket package.

Client starts at bootstrap cursorC, buffers until that snapshot/required terrain is installed, then applies batches `(C,head]`. Ignore duplicates<=applied; a gap/schema/hash mismatch or retention reset discards partial work and fetches a new consistent snapshot. No applying half a completion or re-debiting/re-contributing after reconnect. HTTP poll fallback every2s only while visible/disconnected uses the identical log. Pause background polling; foreground revalidates/reconnects. Show disconnected/pending state truthfully.

Private access revocation is checked in DB before enqueue; missed wake signals are bounded by250ms poll/epoch checks, target<=1s server-side stop of new enqueues. Previously queued network bytes/screenshots cannot be recalled. Hourly OAuth freshness applies even without UI requests. Shared batches contain no private membership event, so private actions cannot leak as unexplained shared cursor gaps. At-least-once delivery is supported; exactly-once transport is not claimed.

Replay/pruning follows the schema retention contract, with replayFloor monotone and safe reset. Snapshot recovery retains current project/building/count/credit facts after seven days or10,000 batches; receipt/eligibility retention is independent. No replay or asset cache is an authority to mint units or reconstruct an incomplete world from seed.
