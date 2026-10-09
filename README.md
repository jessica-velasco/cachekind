# Cachekind

**A resilient Redis cache handler for self-hosted Next.js.**

Cachekind shares Next.js's incremental server cache across multiple Node.js
instances while treating Redis as an optimization: unavailable, slow, or
corrupt Redis data becomes a bounded cache miss instead of an application
failure.

> **Status: alpha preview.** Cachekind has an automated trust suite, but it has
> not yet been validated in a representative production deployment. Expect API
> changes and do not treat this release as production-ready.

The initial alpha targets Next.js 16.3.8 or newer, Redis 7.2 or newer, and the singular
`cacheHandler` contract for `FETCH`, `APP_PAGE`, and `APP_ROUTE`. Cache
Components (`'use cache: remote'`) and image caching are not included yet.

## Development disclosure

Cachekind was developed using an agentic engineering workflow. AI coding agents
contributed to architecture exploration, implementation, tests, documentation,
and verification under human direction and review. Changes are evaluated
through explicit plans, source review, executable tests, and release gates.

This is a process disclosure, not a guarantee that the software is correct,
secure, or suitable for a particular deployment. The repository's
[engineering process](https://github.com/jessica-velasco/cachekind/blob/main/docs/ENGINEERING.md)
explains the practical meaning.

## Why Cachekind

- Safe default: only FETCH entries are shared; pages and routes require opt-in.
- Correct distributed invalidation without key scans, pub/sub, or Redis server
  configuration.
- Finite TTLs and value-size limits on every package-owned entry.
- Build-scoped keys that isolate rolling deployments by default.
- Binary-safe Next.js values without base64-encoding Buffers into JSON.
- Timeouts, circuit breaking, late-result protection, and automatic recovery.
- One convenient owned Redis connection or an application-owned transport.
- Production standalone and two-instance verification, including TLS.

## Quick start

The repository is prepared for `0.1.0-alpha.0`; the command below becomes usable
after the alpha is published under the `alpha` tag.

```sh
npm install cachekind@alpha
```

Create `cache-handler.cjs`:

```js
'use strict'

const { createIncrementalCacheHandler } = require('cachekind')

module.exports = createIncrementalCacheHandler({
  redis: process.env.REDIS_CACHE_URL
    ? { url: process.env.REDIS_CACHE_URL }
    : false,
  namespace: 'my-app',
})
```

Register it in `next.config.js`:

```js
/** @type {import('next').NextConfig} */
module.exports = {
  cacheHandler: require.resolve('./cache-handler.cjs'),
  cacheMaxMemorySize: 0,
}
```

Give every instance of the same build the same runtime `REDIS_CACHE_URL` and
namespace. A standard `redis://` or `rediss://` URL is supported. Cachekind does
not read environment variables by itself and opens no connection when configured
with `redis: false`.

Read the [five-minute quick start](./docs/QUICKSTART.md) before deployment and
the [cache-safety guide](./docs/CACHE-SAFETY.md) before enabling page or route
output.

## Documentation

- [Five-minute quick start](./docs/QUICKSTART.md)
- [Cache-safety guide](./docs/CACHE-SAFETY.md)
- [Configuration reference](./docs/CONFIGURATION.md)
- [Deployment and managed Redis](./docs/DEPLOYMENT.md)
- [Operations and failure behavior](./docs/OPERATIONS.md)
- [Migration guide](./docs/MIGRATION.md)

## Development

Development, compatibility, and release material stays in the repository:
[trust suite](https://github.com/jessica-velasco/cachekind/blob/main/docs/TRUST-SUITE.md),
[Next.js contract notes](https://github.com/jessica-velasco/cachekind/blob/main/docs/NEXTJS-CONTRACT.md),
[release process](https://github.com/jessica-velasco/cachekind/blob/main/docs/RELEASING.md),
and [roadmap](https://github.com/jessica-velasco/cachekind/blob/main/ROADMAP.md).

```sh
npm install
npm run check
npm run pack:check
npm run verify:probe
```

With a disposable Redis instance:

```sh
CACHEKIND_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:redis
CACHEKIND_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run verify:shared
```

The shared verifier builds a production standalone app, starts two independent
Next.js servers, and checks shared page and route hits plus cross-instance tag
and path invalidation.

Cachekind is licensed under the [MIT License](./LICENSE). Security issues should
not be reported in public issues.
