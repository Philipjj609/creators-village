# Creator's Village

A persistent village built together by creators and their communities.

Twitch signs people in; private memberships and world grants determine access. React and PixiJS render original illustrated terrain/buildings, four deterministic fictional residents and contextual People, Places and Projects. Creators can place supported workshops on the actual grid. New projects pool community Orbs; historical one-action projects retain their original rules and receipts.

## Hackathon release

The intended release tag is hackathon-2026-11-02-r1, based on accepted F3.1 RC1. [Source inventory](R1-SOURCE.json) records accepted hashes and omitted temporary tools. [Release notes](RELEASE.md) explain migration/recovery. This snapshot does not itself deploy or modify a database.

[Application](https://creators-village.onrender.com/) · [Read-only example](https://creators-village.onrender.com/villages/showcase-fern) · [Judging guide](JUDGING.md)

The public example is a reproducible renderer example with no genuine member activity. Signing in does not create a village or grant access to a private community.

## Build

Use Node24.22.1 and pnpm11.6.0:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm -r build
    pnpm typecheck
    node scripts/build-release.mjs
    docker build --platform linux/amd64 -t creators-village:r1 .

Integration tests require an isolated local PostgreSQL instance and freshly generated ignored credentials; see JUDGING.md. Never point a resetting harness at a personal or hosted database. No secrets or runtime data are included.

## Scope

Community Orbs are separate from Twitch Channel Points:30 initial,5 per completed five-minute active-village interval, earning cap120 and60 per supported workshop. Balances, receipts, spending and completion are server-authoritative. A private contribution does not imply consent to public recognition.

Tree clearing, followed-channel discovery, personal housing, Extension/chat bot/EventSub/OBS integration and unrestricted creator onboarding are not shipped features. No open-source rights grant is introduced; see LICENSE-NOTICE.md.
