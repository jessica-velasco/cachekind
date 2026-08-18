# Cachekind configuration

The Redis-backed Next.js incremental handler is implemented for `FETCH`,
`APP_PAGE`, and `APP_ROUTE`. The public entry automatically becomes a no-op in
the Edge runtime, so configured Edge routes do not load Node Redis code.

Cachekind configures singular Next.js `cacheHandler`. It does not implement the
separate plural `cacheHandlers` contract used by Cache Components and
`'use cache'` directives.

## Safe default

```js
const { createIncrementalCacheHandler } = require('cachekind')

module.exports = createIncrementalCacheHandler({
  redis: process.env.REDIS_CACHE_URL
    ? { url: process.env.REDIS_CACHE_URL }
    : false,
  namespace: 'my-app',
})
```

When Redis is disabled, Cachekind opens no connection and behaves as a cache miss. When enabled, only `FETCH` is shared by default.

Build-scoped policies lazily discover `.next/BUILD_ID` from the server directory
provided by Next.js. Deployments may override discovery with a string or async
function when their release identifier comes from another source.

## Reusing an existing Redis client

Projects that already manage Redis should inject a Cachekind transport instead
of opening another connection:

```js
const { createIncrementalCacheHandler } = require('cachekind')
const { createNodeRedisTransport } = require('cachekind/node-redis')
const { redisClient } = require('./redis')

module.exports = createIncrementalCacheHandler({
  redis: { transport: createNodeRedisTransport(redisClient) },
  namespace: 'my-app',
})
```

The transport is application-owned. It must already be ready for commands, and
the application remains responsible for connecting, reconnecting, configuring,
and closing it. Cachekind never changes or closes an injected transport.

The transport implements only the operations Cachekind needs: Redis server
`time`, binary-safe `get`, `getMany`, `set`, and `delete`. Server time prevents
application clock skew from breaking tag invalidation. `set` must apply the
supplied finite TTL as part of the write. `getMany` must preserve input order
and work across Redis Cluster hash slots, normally by pipelining independent
`GET` commands rather than using `MGET`.

Cachekind provides the Node Redis adapter at `cachekind/node-redis`. Additional
client adapters can implement the same public transport contract without
changing Cachekind's storage or resilience logic.

## Managed Redis over TLS

Use the provider's standard `rediss://` URL. Cachekind does not run `CONFIG` commands and will not depend on keyspace notifications.

```js
module.exports = createIncrementalCacheHandler({
  redis: { url: process.env.REDIS_CACHE_URL },
  namespace: 'my-app',
  buildId: () => process.env.DEPLOYMENT_SHA,
})
```

The first release supports Redis 7.2 and newer 7.x releases. URL mode uses one
lazy Cachekind-owned connection, disables the offline queue, reconnects
automatically, and unrefs its socket so it cannot keep the process alive. See
[the measured client selection](./REDIS-CLIENT-SPIKE.md) for the tradeoffs.

## Opting into page and route caching

Only enable HTML-producing cache kinds when the output is non-personalized.

```js
module.exports = createIncrementalCacheHandler({
  redis: { url: process.env.REDIS_CACHE_URL },
  namespace: 'public-marketing-site',
  buildId: () => process.env.DEPLOYMENT_SHA,
  policies: {
    APP_PAGE: { enabled: true, scope: 'build' },
    APP_ROUTE: { enabled: true, scope: 'build' },
  },
})
```

Every enabled policy has a finite maximum TTL. `tagTtlSeconds` cannot be shorter than an enabled entry's maximum TTL; otherwise an invalidation marker could disappear while an older entry remains readable.

`resetRequestCache()` is intentionally a no-op because Cachekind has no
request-local L1 cache. Handler instances created from the same factory share
one Redis store and one URL-mode client.

## Policy reference

| Setting | FETCH default | APP_PAGE default | APP_ROUTE default |
| --- | ---: | ---: | ---: |
| `enabled` | `true` | `false` | `false` |
| `scope` | `build` | `build` | `build` |
| `defaultTtlSeconds` | 3,600 | 3,600 | 3,600 |
| `maxTtlSeconds` | 86,400 | 86,400 | 86,400 |
| `maxValueBytes` | 2 MiB | 5 MiB | 5 MiB |
| `timeoutMs` | global timeout | global timeout | global timeout |

`expire` supplied by Next.js takes precedence over `revalidate` for the Redis
TTL, and the result is capped by `maxTtlSeconds`. A missing or unusable lifetime
uses `defaultTtlSeconds`. Every TTL must be a positive safe integer.

## Resilience reference

| Setting | Default | Purpose |
| --- | ---: | --- |
| `resilience.timeoutMs` | 1,500 ms | Default read, write, delete, connection, and policy budget. |
| `resilience.invalidationTimeoutMs` | 10,000 ms | Separate budget for distributed tag invalidation. |
| `resilience.cooldownMs` | 5,000 ms | Time before an open circuit breaker allows a recovery probe. |
| `tagTtlSeconds` | 604,800 s | Lifetime of tag invalidation timestamps. |

A per-policy `timeoutMs` overrides the global operation timeout for that kind.
The tag TTL must be at least the largest `maxTtlSeconds` among enabled policies.

## Complete example

```js
module.exports = createIncrementalCacheHandler({
  redis: process.env.REDIS_CACHE_URL
    ? { url: process.env.REDIS_CACHE_URL }
    : false,
  namespace: 'storefront-production',
  buildId: () => process.env.DEPLOYMENT_SHA,
  tagTtlSeconds: 7 * 24 * 60 * 60,
  policies: {
    FETCH: {
      enabled: true,
      scope: 'build',
      defaultTtlSeconds: 3_600,
      maxTtlSeconds: 86_400,
      maxValueBytes: 2 * 1024 * 1024,
      timeoutMs: 250,
    },
    APP_PAGE: { enabled: false },
    APP_ROUTE: { enabled: false },
  },
  resilience: {
    timeoutMs: 250,
    invalidationTimeoutMs: 2_000,
    cooldownMs: 1_000,
  },
  logger,
  reportError,
})
```

`namespace` must contain 1–64 letters, numbers, dots, underscores, or hyphens.
When no `buildId` override is supplied, Cachekind lazily reads `.next/BUILD_ID`
using the server directory passed by Next.js.

See [Operations](./OPERATIONS.md) for logger and error-reporter signals.
