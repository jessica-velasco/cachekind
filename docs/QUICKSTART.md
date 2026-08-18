# Five-minute quick start

Cachekind shares the Next.js incremental server cache between two or more
self-hosted Node.js instances. It targets Next.js 16.2 and Redis 7.2 or newer.
It does not implement Cache Components or `'use cache: remote'`.

## 1. Install

During the alpha period, install the `alpha` tag:

```sh
npm install cachekind@alpha
```

## 2. Create the handler

Create `cache-handler.cjs` beside `next.config.js`:

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

Cachekind deliberately does not read environment variables itself. Your
application decides their names and whether Redis is enabled. Keep the Redis
secret available at runtime; it does not need to be present during `next build`.

## 3. Register it with Next.js

```js
// next.config.js
/** @type {import('next').NextConfig} */
module.exports = {
  cacheHandler: require.resolve('./cache-handler.cjs'),
  cacheMaxMemorySize: 0,
  output: 'standalone', // only when using Next.js standalone containers
}
```

`cacheMaxMemorySize: 0` prevents a per-process Next.js memory cache from hiding
shared invalidations. `output: 'standalone'` is not required for `next start`.

## 4. Supply Redis at runtime

Use a standard TCP or TLS URL:

```text
redis://username:password@redis.internal:6379
rediss://username:password@redis.example.com:6379
```

Percent-encode reserved characters in usernames and passwords. Store the URL in
your platform's secret manager rather than in source control.

Only `FETCH` is shared by default. That includes compatible Next.js fetch-cache
and `unstable_cache` entries. Page and route output stay disabled until you make
an explicit safety decision.

## 5. Verify two instances

Start the same production build twice with the same Redis URL and namespace:

```sh
PORT=3000 REDIS_CACHE_URL="$REDIS_CACHE_URL" node .next/standalone/server.js
PORT=3001 REDIS_CACHE_URL="$REDIS_CACHE_URL" node .next/standalone/server.js
```

Request a cacheable route through each instance. For ISR pages and cached route
handlers, the expected progression is `MISS` on the first instance followed by
`HIT` on the second. Then call a test-only revalidation endpoint on one instance
and confirm the other instance returns `MISS`.

Before enabling shared HTML or route output, read [Cache safety](./CACHE-SAFETY.md).
For full configuration, see [Configuration](./CONFIGURATION.md).
