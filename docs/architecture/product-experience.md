# Product experience and UI architecture

2026-10-30, proposal for the integrated product. This is a design specification, **not implemented navigation or approved visual identity**. Audit (internal source record omitted), dependency cards (internal source record omitted). Existing world IDs, v1 URLs, private grants, CP1 and saved assets remain authoritative.

## Product spine

Arrive → understand this is a persistent community world → explore an explicitly public/curated village → sign in with Twitch when needed → find your existing/approved communities → open the same village → inspect a place/project → deliberately contribute if authorized → observe persistent change → return to its history.

Anonymous exploration does not create a person, membership or inhabitant. Twitch sign-in creates/loads the existing person record; no redundant password or profile registration. A follow relationship helps discovery only after optional provider consent. Private participation still requires the accepted request/approval flow. Creator ownership and canonical village selection never come from a client-supplied role, followed status or Twitch moderator badge.

## Route/page inventory

All paths below are proposed. Route resolution must fetch a safe version/capability descriptor, then dispatch the proper retained reader. Never infer format from appearance or overwrite v1. IDs are stable; a future slug can be an alias. Restricted/nonexistent worlds use the same safe unavailable state.

| Route / surface | Audience / responsibility | Content, action and placement | Submission priority / present equivalent |
|---|---|---|---|
| `/` | Everyone | Concise promise, actual curated image/live preview, Explore and Sign in; prototype/visual status honest. No fabricated member counts/activity. | Must; current root is legacy showcase rather than landing. |
| `/explore` | Everyone | Small curated/public directory, purpose/source labels, links to real projections. Only worlds explicitly allowed public are listed. | Minimum featured selection; public directory policy needs approval. No current directory API. |
| `/sign-in` | Everyone | Twitch account explanation, retry/declined/outage states, privacy links; calls retained `/auth/twitch`. | Must states; existing button/server flow reused. |
| `/communities` | Signed-in person | **My communities** from own grants/creator association; separate **Following** tab only if optional scope approved; manual public links work without it. Legacy and development worlds clearly distinguished. | Must own-grants list; following optional/deferred. Current `/playtest` entry has basic own links. |
| `/villages/:worldId` | Per-world read policy | Full viewport, Places, contextual projects/inspection/history. Badge: legacy, private development, curated showcase as applicable. | Must; current query readers and `/playtest?world=` become aliases. |
| `/villages/:worldId?inspect=:structureId` | Same read policy | Select object, highlight, focus camera and open inspection. Function, current plan/result, entrance and optional consent-based credits; no invented inventory/occupants. | Must; current Places/focus reused. Same geometry/materials for overview/focus. |
| `/villages/:worldId?panel=projects` | Per-world grants | Contextual project list/progress, deliberate action, original private receipt link, visible blocked/retry/cancel for creator. | Must; current WF2 commands/state retained. |
| `/villages/:worldId?panel=history` | Per-world grants | Durable published/completed milestones and current cancellation status from authorized project/result facts; click event to focus real structure. No private admissions/rosters or old withdrawn names. | Small must increment; full cultural timeline later. Replay batches are not history. |
| `/create` | Eligible creator | Explain one canonical active village and mostly undeveloped founding; immutable job status/recovery. Existing active/legacy users routed to their saved world. | Conditional public onboarding after RG1/RG2 and policy review; existing founding form can stay private/limited until then. |
| `/creator/:communityId` | Creator-authorized | Management workspace: published settings, admission/moderation, project planning and operational status. Enter village remains primary. | Bounded private-console reuse now; wider registration/management policy later. |
| `/creator/:communityId/members` | Creator | Minimum identity for pending approval, explicit approve/decline, leave/ban/unban semantics. No public roster. | Must for private loop; current Private admission panel reused. |
| `/join` | Invitation recipient | Retain one-use continuation, account confirmation, Request creator approval, pending/approved/declined/expired/banned states. No access from token alone. | Must; existing implementation retained. |
| `/settings` | Signed-in person | Connection status/logout, privacy explanation, own receipts and consent withdrawal, reduced-motion/quality preferences. No universal-delete promise. | Minimum privacy/account must; current controls reused. |
| `/settings/recognition` | Same person, including revoked members | Project-scoped consent/withdrawal and private receipts survive loss of village viewing rights. Never require map access for withdrawal. | Must; existing restricted endpoints retained. |
| `/character` and village character panel | Explicit participant, future consent | Persistent appearance/identity; per-world visible presence and later home/job. Separate from following and contribution recognition. | Later by default; no current data model. Hide navigation until real capability exists. |
| `/help`, privacy, unavailable/404 | Everyone | Local controls, named support/error code, access semantics, verification/device limits, accessibility; retry without replaying a completed command. | Must minimal content/states; no dummy settings. |
| `/studies/*` | Development/review only | Preserve original V03/V04/H01 studies and evidence with conspicuous study label. | Not normal product navigation. Shipping one as curated showcase requires explicit build/provenance/access choice. |

Keep existing API paths unless an actual migration is needed. The web router is not permission enforcement. A UI route may exist without granting access; the server still authorizes every projection and command. Unknown paths must become a real404 instead of silently displaying the old showcase.

## Village layout and interaction grammar

The canvas fills the usable viewport, not a card beneath a dashboard. Restrained56–64px topbar contains community/world identity, back to communities, connection state and account menu. Main camera never scrolls away with a long form. A compact contextual rail offers Places, Projects and History; diagnostics are behind a developer-only disclosure and absent from the public primary flow.

Desktop: canvas remains at least roughly70% of width when a336px inspection panel is open on a1440px display. At narrower sizes the panel overlays the canvas rather than permanently splitting it. Panel close returns focus to the selecting DOM control; selecting a building preserves world/camera state. Browser back closes the inspect/panel state before navigating away. No remount or terrain regeneration for a count/credit change.

Mobile: use `100dvh`, safe-area insets and a compact topbar; canvas remains full-bleed underneath a collapsed bottom action sheet. Default sheet is compact (~30–40% height), can expand for forms and scroll independently; expanded content must not trap keyboard users. Switch pan/pinch and DOM controls gracefully. A Places list offers every essential inspection/action without requiring precision canvas input. No orientation lock or claim that viewport emulation proves iOS readiness.

| Interaction | Surface | Reason / authority |
|---|---|---|
| Pan/zoom/reset/select | Canvas plus accessible controls | Cosmetic client state; no mutation/attendance reward. |
| Building detail/function/current credits | Right panel/bottom sheet; camera focus in same scene | Same source geometry, authorized current projection. |
| Project progress/contribute/receipt | Contextual project panel; compact completion confirmation | Explicit command, server amount/receipt; no optimistic completed building. |
| Place/revise draft | In-world ghost/path preview with context controls | Server validates; no reservation until publish. |
| Publish/cancel/retry | Clear contextual confirmation tied to immutable plan | Creator-only; explain non-transfer of accepted work and permanent published plan. |
| Admission/moderation | Dedicated creator page, optional notification leading there | Minimum private identity, avoids roster on public canvas. |
| Own privacy/withdrawal | Dedicated settings/receipt surface | Works after access loss. |
| Future character needs/jobs/home | Character panel/dedicated page once real systems exist | Never invented from connection or follow status. |

OAuth return targets need server-owned, expiring context with fixed same-origin relative destinations. Retain existing join continuation. Do not add arbitrary `returnTo` URLs or forward invitation tokens into the Twitch authorization request. This is a routing-integration requirement, not an already supported parameter.

## Initial design system — proposal, independent of final world art

Use existing platform fonts first, with no download/install. Body: system-ui/Segoe UI/Arial,16px base,1.5 line height; headings may use existing Georgia sparingly for warmth. Functional labels14–16px, critical messages never tiny. Keep brand typography independent from the unapproved H01 architectural style.

Proposed semantic palette: parchment surface `#FBF8F0`, deep text `#24372F`, secondary text `#59685F`, forest action `#365C48`, warm accent `#8A5321`, focus `#245C8C`, danger `#8B3028`. Restrained berry/thread accents can suggest conversation/community without Twitch logos or purple saturation. Color is never the sole status signal. Verify actual contrast and state combinations against WCAG2.2AA before adoption; these values are candidates, not tested accessibility evidence.

Spacing on4px grid:4/8/12/16/24/32; 16–24px panel gutters. Small radius8px for controls,12px panels; restrained borders and shadows; avoid piling nested cards over the scene. Primary buttons show the next meaningful action, secondary controls remain quiet, destructive actions explicit. Minimum44×44px target; visible keyboard focus, proper labels, native semantics and predictable tab order. One shared set of Button/Field/Panel/Dialog/StatusBanner/EmptyState/ProjectCard/Receipt primitives inside web; create a separate UI package only after another real consumer exists. No Tailwind installation required to implement tokens with CSS variables.

Motion: brief150–250ms panel transitions, restrained camera interpolation, reduced-motion alternative and instant state feedback. Completion celebration cannot obscure the scene or imply uncommitted work. Local inhabitant animation remains separate from meaningful persistent decisions. Pause rendering/polling appropriately in background without promising an offline activity reward.

Required state matrix: anonymous / signed-in-not-admitted / pending / active / revoked / banned; no community / founding job pending-working-failed-ready / renderer loading-failed / project draft-open-ready-blocked-completed-cancelled; command pending-committed-retryable-rejected / connected-recovering-offline-update-required. Accessible text must explain what is known, preserve committed state where safe, clear protected state after revocation and expose a useful recovery action. No default empty screen, infinite spinner, raw `[object Object]` errors or missing-asset substitution.

## Twitch belonging and scalable presence

| Concept | Facts/authority | UX and persistence boundary |
|---|---|---|
| Follows a Twitch channel | Provider relationship, optional `user:read:follows` for the signed-in user's own list | “Communities you follow” discovery only; no global follower roster, permissions or character creation. |
| Discovers a village | Public/curated directory or private invitation | Read policy still decides what is visible. Do not list a private development world from follow matching. |
| Chooses to participate | Explicit confirmed join request | Existing person record reused; no second registration. Private creator approval remains P2. |
| Has capabilities | Server-scoped membership + grants | Buttons reflect capabilities, not a name, follow badge or Twitch moderator role. Revocation blocks new actions without falsifying accepted work. |
| Has an inhabitant | Future explicit initialization/visibility consent | Global character identity versus per-village residence; no follower-sized population. New policy/schema requires review. |
| Is currently connected | Ephemeral authorized transport state | Not automatically public presence, attendance or work. Presence consent must be separate from named contribution consent. |

Twitch's [Get Followed Channels](https://dev.twitch.tv/docs/api/reference#get-followed-channels) requires `user:read:follows`, token subject matching `user_id`, pagination up to100 entries/page. If approved later, fetch a bounded portion on user request, intersect only with approved public directory entries, show partial-results/provider-outage states, and minimize retention. A complete follow graph is unnecessary. No background enumeration of every creator follower; moderator follower scopes are not basic identity. Declining follows scope keeps manual discovery and joining usable. Unfollowing does not silently revoke village membership or delete a character; any such future policy needs review.

Future living-world boundary: durable participant decisions/home/job/major task transitions in PG; versioned due-time scheduler and bounded catch-up; utility choice with hysteresis plus finite-state task execution; topology epoch invalidates derived routes; client interpolates valid movement. Instantiate only explicit inhabitants and a bounded, labelled NPC population. No LLM requirement, unbounded follower simulation, mandatory daily penalties or automatic reassignment of irreversible player commitments. These systems remain absent today and outside the default November2 cut.
