# F4 — follower discovery, scalable membership and separated permissions

Post-submission work on branch `post-submission/follower-discovery`, cut from release commit `08f89b63ee8133292e57a41006f5b60136218797`. **Not part of the submitted R1 release.** The R1 tag, the judging repository and the production deployment/database are untouched. Nothing here has been migrated or deployed; production remains schema 9 until a separate review and approval.

Development assistance: implemented with Claude (Anthropic) under the project owner's direction and review. Commits, authorship and publication are performed by the project owner.

## What a user and a creator can do

| Role | Capability |
|---|---|
| Any signed-in user | Optionally connect Twitch follows, see villages of followed creators **who opted in**, refresh manually, and join one with a single press. |
| Creator | Turn follower joining on or off (default **off**), choose whether new followers may contribute Orbs, set the member limit, and edit each member's permissions. Invitations keep working unchanged. |
| Member (any source) | Holds exactly the permissions the creator granted. Membership alone is view access. |

Unfollowing only removes a village from the discovery list. It never changes membership, grants, contribution history, Orb ledgers or any future home.

## Security model

- **Scope**: default sign-in stays `scope=""`. A separate, optional authorization (`GET /auth/twitch/follows`) requests only `user:read:follows`. The state row records `purpose='follows'` and the starting session hash; the callback only upgrades *that* session, only for the *same* Twitch account, and only if Twitch actually granted the scope (the consent screen allows deselecting it). The granted scopes are stored on the session (`sessions.granted_scopes`) and vanish with it.
- **API**: Twitch *Get Followed Channels* (`GET https://api.twitch.tv/helix/channels/followed`) with the user's own token. Refresh pages through the list (100 per page, capped at 20 pages); joining re-verifies the single relationship live with `broadcaster_id`. A 400/401/403 from Twitch drops the stored scope and answers `RECONNECT_REQUIRED`; other failures answer `PROVIDER_UNAVAILABLE`.
- **Data minimisation**: only matches against opted-in villages are stored (`wf2_follow_matches`); the full followed list is discarded in the same request. Rows older than 24 h are not shown. No creator can see who follows them from this feature.
- **No existence oracle**: unknown, disabled or non-opted-in villages all answer 404 on join. Discovery excludes villages where the viewer is already active, banned or rejected.
- **Moderation outranks following**: banned and rejected people cannot use follower joining. Leaving is allowed to rejoin.
- **Abuse limits**: manual refresh is limited to one per 60 s per person (database-enforced, `429 REFRESH_TOO_SOON`). Joining is serialized on the world binding row, so concurrent joins cannot exceed the limit. State-changing routes require same-origin + CSRF token and are blocked while gameplay writes are paused.
- **Feature flag**: `FOLLOWER_DISCOVERY=follower-discovery-1` (unknown values fail startup). Absent → R1 behavior and response shape.

## Scalable membership, independent of the simulation

The eight-member cap lives in `wf2_rulesets.max_non_creator_members` and is a legacy test-cohort limit. F4 adds a per-community **membership limit** (`wf2_community_settings.member_limit`, 1–5000, default 500) that counts people only. It is not tied to simulated inhabitants, rendered characters or residential space; those are separate systems that may later be driven by active participation, not by the member count. Until a creator saves settings, the legacy ruleset cap still applies, so existing communities behave exactly as in R1. The effective limit is read by one function (`memberLimit`) used by both invitation approval and follower joining.

## Permissions separated from membership

Membership (`wf2_memberships.state`) and view access (`can_view`) are independent of four grants on `wf2_world_grants`:

| Column | Controls |
|---|---|
| `can_contribute` | Contribute / fund Orbs (R1 meaning, unchanged) |
| `can_create_projects` | Placement checks, `CreateDraft`, `ReviseDraft`, draft list |
| `can_manage_construction` | `PublishProject`, `CancelProject`, `RetryCompletion`, revise |
| `can_moderate` | Invitations, approve/reject, ban/unban, admission list |

The creator is identified by the binding and always holds everything. Only the creator can change permissions or settings. A moderator cannot act on the creator or on another moderator, cannot widen permissions, and cannot change settings. A database `CHECK` forbids any permission without `can_view`; leaving or being banned clears all of them in the same statement. Follower joiners get `can_view` plus `can_contribute` only if the creator enabled it; never the three management permissions. Existing members keep R1 behavior (view + contribute).

## Persistence compatibility

`010_follower_discovery.sql` is additive: new columns have safe defaults (`join_source='invitation'`, permissions `false`), three new tables, two new session/state columns, scoped `cv_runtime` grants. No historical row is rewritten and no existing constraint is relaxed. Existing invitation memberships, receipts, wallets, ledgers and projects are unaffected. Follower memberships reuse `wf2_memberships` / `wf2_world_grants`, so `/api/communities`, entry lookups, the event stream's authority checks and Orb eligibility work without change. A server running this code requires schema 10; schema 9 servers (R1) ignore the new columns, but an R1 server on a schema-10 database fails its strict startup fence, so rollback after migration follows the R1 forward-fix rule.

## How it fits the interface

**My Communities** (`/communities`): the former placeholder becomes *Villages you follow* beneath your requests.

1. *Not connected* — one sentence explaining the optional, read-only use and that following never grants access, plus **Connect Twitch follows**.
2. *Connected* — list of villages (name, creator, plain-language note on what joining allows, and whether followers may contribute Orbs) with **Join village**; **Refresh** with "Updated at …"; an automatic refresh once when the page opens with a cache older than 15 minutes; **Stop using Twitch follows**.
3. After joining, the village moves into *Villages you've joined* like any invited village. After unfollowing it simply stops being offered.
4. When the feature is off, the R1 text is shown unchanged.

**Community settings** (creator's village → Community panel): *Let followers join*, *New followers can contribute Orbs*, *Member limit* (with the legacy limit explained until first save), and **Save**. Under each member, **Manage access** now shows four permission toggles and whether they joined as a follower, above the existing ban control.

## Testing

- `tests/follower-discovery.test.ts` (12, real PostgreSQL): default-off, creator-only settings/validation/stale revisions, discovery storing only opted-in matches and rate limiting, immediate view-only join + idempotency + denied management, unfollow preserving membership, concurrent joins at the limit, ban/reject precedence, permission separation and moderator limits, DB check, OAuth upgrade binding (wrong session, wrong account, deselected scope, success, single-use state, default login unchanged), provider failure/revocation/disconnect, and disabling.
- `tests/follower-ui.test.ts` (4): legacy copy, connect, connected list, empty/error copy.
- Full regression: R1's 161 tests plus the above, all passing; typecheck and build clean.

## Not done / follow-ups

- No live Twitch call has been made (fake gateway). A real two-account check on a staging copy is required before any rollout.
- Delegated *planner/moderator* screens: the server enforces the permissions, but the village UI still shows planning and community panels to the creator only.
- Per-follower Orb allocation is unchanged (30 on first eligible visit); consider a separate join-time throttle before enabling `followerCanContribute` widely.
- Production migration, `FOLLOWER_DISCOVERY` activation, Render configuration and the Twitch app's registered scopes need a separate review and approval.
