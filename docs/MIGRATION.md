# Migration

Cachekind uses its own versioned keys and binary encoding. It does not read or
convert entries created by Next.js's filesystem cache, another Redis handler,
or a custom implementation. A migration therefore starts with a cold Cachekind
namespace and lets old data expire or be removed using the previous system's
documented process.

## From the default Next.js cache

1. Add `cache-handler.cjs` and register it through singular `cacheHandler`.
2. Set `cacheMaxMemorySize: 0` so instances do not retain independent memory
   entries.
3. Start with the FETCH-only default.
4. Deploy two instances with the same build, Redis URL, and namespace.
5. Confirm a MISS on one instance becomes a HIT on the other.
6. Confirm tag and path invalidation initiated on one instance is observed by
   the other.

The old `.next/cache` data does not need to be imported. Keep build output and
runtime Redis credentials separate if you want the first runtime request to
populate the shared cache.

## From `@neshca/cache-handler` or `@fortedigital/nextjs-cache-handler`

Replace the exported handler and remove the previous package only after the
new deployment passes the shared-hit and invalidation checks. Existing Redis
keys are not compatible with Cachekind and should use a different namespace.

Review these decisions instead of translating configuration mechanically:

| Previous decision | Cachekind equivalent |
| --- | --- |
| Which cache kinds are shared | `policies.FETCH`, `APP_PAGE`, and `APP_ROUTE` |
| Cross-deployment reuse | `scope: 'stable'`; build scope is the safer default |
| Maximum lifetime | `defaultTtlSeconds` and `maxTtlSeconds` |
| Maximum object size | `maxValueBytes` |
| Redis latency limit | policy `timeoutMs` and `resilience` settings |
| Existing Redis connection | Inject a `CachekindRedisTransport` |
| Tag index or key deletion | Cachekind uses TTL-bound invalidation timestamps instead |

Cachekind intentionally has no L1 fallback, pub/sub dependency, tag-key scan,
or Redis server configuration requirement. Account for those architectural
differences when comparing behavior.

## From a custom handler

List the kinds your handler currently receives and any behavior it implements
beyond the stable Next.js methods. Cachekind's first release supports only
`FETCH`, `APP_PAGE`, and `APP_ROUTE`; `IMAGE` and Cache Components are deferred.

Do not configure Cachekind under plural `cacheHandlers`. Next.js uses singular
`cacheHandler` for ISR, route-handler responses, patched fetches, and
`unstable_cache`. Plural `cacheHandlers` is the separate streamed contract for
`'use cache'` directives. See the official [Next.js cacheHandler reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath).

## Low-risk rollout

1. Choose a new namespace.
2. Deploy FETCH-only to a small percentage of instances.
3. Compare application latency, Redis latency, warning counts, and upstream
   regeneration load.
4. Exercise tag and path revalidation across instances.
5. Roll out FETCH sharing fully.
6. Review public-output safety before separately enabling pages or routes.

Rollback consists of restoring the previous `cacheHandler` configuration and
redeploying. Cachekind's abandoned keys disappear through their TTLs; they do
not need to be deleted during rollback.
