# ADR-0006 — approved WF2 private-playtest policy

2026-10-29. **Policy accepted by project owner in chat; implementation NOT authorized.** This supersedes the pending cells in the v0.16 worksheet, not the preserved milestone history. Source baseline `6984b3e4548582d3c38f8826448d733d3f8b4e77`. Final assignment/contracts are prepared for separate implementation approval in v0.17.

| Decision | Accepted disposition |
|---|---|
| P1 | Existing private v2 development world, explicit participant approval and world-scoped view/contribute capabilities. Preserve v1, creator ownership and one-active-village policy. No public promotion or new worlds. |
| P2 | Creator approval; one-use24-hour request link grants no access. Leave requires approval to rejoin; banned users require explicit administrative unban before another request/approval. Minimum verified Twitch identity for review only. |
| P3 | CP1: one deliberate server-valued action/account/project, two distinct real participants for this test, no wallet/passive watch-time rewards/paid advantages. Test ruleset, not permanent village minimum. |
| P4 | Private receipts/default-off named recognition. Explicit consent for this project and resulting building; withdrawal never invalidates work. No public provider IDs/private roster. |
| P5 | Complete workshop/path plan, location and goal freeze at publication. Replacement is cancellation plus a new project and fresh actions. Spatial/support/navigation validation retained. |
| P6 | Automatic verified-threshold completion; old accepted work remains valid after revocation. Blocked retries use identical approved plan. Cancellation preserves records/releases reservations. No CP1 retroactive fraud correction. |
| P7 | Minimal durable contribution/dedup facts; documented retention/deletion limits; sanitized operations logs14days; replay7days/10,000 batches with snapshot recovery. Attribution separately revocable; no complete anonymity/universal deletion claim. |
| P8 | Up to8 non-creator playtest members,1 active spatial project,1 workshop family. Versioned test limits; drafts do not consume active slot; blocked projects expose retry/cancel. |
| P9 | Explicit private cohort may proceed before RG1/RG2. Public creator onboarding/release, new-v1 retirement and wider access remain gated. Existing worlds/receipts preserved. |

The test needs two independently participating humans/accounts, with at least one non-creator. Account distinctness is server-verifiable; human independence is a final supervised evidence requirement, not inferred from OAuth. Creator plus one participant is sufficient; no simultaneous attendance or public naming is required.

No wallet, unrestricted construction, clearing/grading, production jobs, personal property, new government roles, general procedural engine, deployment or new dependency is authorized. Artist/H01/CV-S1 acceptance remains open. RG1/RG2 are not secretly included in this implementation assignment; RG3 terrain/rebuild/device evidence continues inside the bounded scene.

## Technical operationalizations, not reopened product decisions

- Creator is the only administrative actor in WF2. `Unban` is an explicit action restoring eligibility to request admission, not automatic membership/access. Member leave/ban/revoke suppresses optional current credit and never restores it implicitly on rejoin; the accepted contribution stays valid. Independent credit withdrawal is available through an authenticated own-receipt privacy route even without world access.
- A draft may be edited/replaced freely under its revision; after publish, the complete plan is immutable even at zero work. `open/ready/blocked` consume the single spatial slot; drafts/completed/cancelled do not.
- Durable eligibility/receipt links remain for project/world life while those records exist; no cascading deletion of accepted work. Personal-name views are separately erasable/withdrawable. Account-wide deletion requires administrative review and is not advertised as an implemented universal erase operation.
- Exact technical constants/protocols and dependency-free algorithms are specified in the linked contracts. If implementation evidence contradicts a safety invariant or requires new consequential scope, stop with that evidence; do not reopen settled policies merely for convenience.

Bounded assignment (internal source record omitted), [schema](../architecture/wf2-schema-contract.md), [commands/realtime](../architecture/wf2-command-contract.md), acceptance tests (internal source record omitted).
