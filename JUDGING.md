# Isolated judging evaluation

This source snapshot has no production database credentials, deployment access, Actions workflow or automation hook. Its publication history is independent of the private application. The required devposttesting account has repository access. R1-SOURCE.json and PUBLICATION-PROVENANCE.json record exact provenance.

## Evaluation

[Hosted application](https://creators-village.onrender.com/) · [Read-only founding example](https://creators-village.onrender.com/villages/showcase-fern)

The public example is deterministic and contains no genuine member contributions. The private village requires existing authorization. Do not request the creator's credentials, cookies or database connection. The owner video can demonstrate private functionality without granting production access.

## Standalone build

Use Node24.22.1 and pnpm11.6.0 in a fresh clone:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm -r build
    pnpm typecheck
    node scripts/build-release.mjs
    docker build --platform linux/amd64 -t creators-village:judging-r1 .

Immutable original runtime art is included; do not rerender it to build. No real Twitch credentials are needed for builds or isolated integration tests. Production OAuth requires your own separately configured Twitch application and exact callback. No shared secret or synthetic production gateway is supplied.

## Isolated PostgreSQL tests

Use a fresh disposable PostgreSQL18 instance on loopback55439. Newer safety guards require this port. Abort if another project owns it. Tests reset fixed synthetic databases and must run serially against a local test-only owner able to create databases. Never supply a production/personal database URL.

In a fresh directory without existing .local environment files:

    node scripts/local-setup.mjs

Change only the generated .local/runtime.env connection's loopback port from55432 to55439; keep the generated local password/key. Then:

    docker run --name cv-judging-evaluation --env-file .local/database.env -p 127.0.0.1:55439:5432 -d postgres:18.6-bookworm@sha256:5c4783a8cc3f0074912164f94dfa1be4e043438f0f707cf968d7af9a0d31a2c8
    docker exec cv-judging-evaluation pg_isready -U cvillage
    pnpm test

Wait until PostgreSQL reports accepting connections. Do not use these commands in an existing configured checkout. Generated .local values are ignored and must not be committed. Retained fixture modules generate synthetic identities/tokens inside local tests; they contain no genuine test credentials and are excluded from the runtime image. Phase-specific preview/capture tools are omitted. The older optional Playwright matrix is not represented as rerun for this release.

## Boundaries

The supported constructible template is the workshop. Four fictional residents are distinct from Twitch participants. New Orb projects use real wallet deductions and pooled amounts; legacy projects retain two-action rules. Names are private unless consent and current authorization permit recognition. Tree clearing and Twitch discovery are deferred. Synthetic tests do not establish genuine independent-human participation or physical-device performance.
