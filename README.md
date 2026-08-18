# Cachekind

**A resilient Redis cache handler for self-hosted Next.js.**

This repository is being built into a managed-Redis-safe shared cache handler for multi-instance Next.js deployments.

The project has completed **Phase 1: package core and configuration**. The publishable package lives directly in this repository under `src/`; the Redis adapter is the next implementation phase. The application under `examples/contract-probe` records and verifies the actual cache-handler calls made by Next.js 16.2 during a production build and standalone server run.

See [PLAN.md](./PLAN.md) for the product scope, architecture, and delivery phases.

## Development checks

```sh
npm install
npm run check
npm run pack:check
```

The package is not published yet. Its current public surface validates configuration and provides a no-connection disabled mode; enabled Redis operations arrive in Phase 2.

## Phase 0 commands

```sh
npm install
npm test
npm run build:probe
CACHE_HANDLER_PROBE=1 npm run start:probe
npm run verify:probe
```

The probe logs one JSON object per cache operation. It records shapes and byte lengths, not cached content.

`verify:probe` runs the generated standalone server and asserts page and route MISS→HIT behavior, Edge execution, and tag invalidation→MISS.
