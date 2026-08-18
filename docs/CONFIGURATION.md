# Cachekind configuration

The API is being validated during Phase 1. These examples compile in CI, but Redis operations are implemented in Phase 2.

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

## Managed Redis over TLS

Use the provider's standard `rediss://` URL. Cachekind does not run `CONFIG` commands and will not depend on keyspace notifications.

```js
module.exports = createIncrementalCacheHandler({
  redis: { url: process.env.REDIS_CACHE_URL },
  namespace: 'my-app',
  buildId: () => process.env.DEPLOYMENT_SHA,
})
```

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
