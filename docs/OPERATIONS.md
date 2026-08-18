# Operations

Cachekind treats Redis as an optimization on the request path. A Redis failure
becomes a cache miss, allowing Next.js to regenerate the result. Invalidation
uses a separate, longer budget because failure to invalidate is more important
than an ordinary missed read.

## Signals to connect

Pass a structured logger and error reporter from the application:

```js
module.exports = createIncrementalCacheHandler({
  redis: { url: process.env.REDIS_CACHE_URL },
  namespace: 'storefront-production',
  logger: {
    info(message, fields) {
      appLogger.info(fields, message)
    },
    warn(message, fields) {
      appLogger.warn(fields, message)
    },
  },
  reportError(error, context) {
    errorTracker.captureException(error, { extra: context })
  },
})
```

Cachekind protects the request path if either callback throws. It reports
metadata, not cached values.

Important operations include:

| Operation | Meaning |
| --- | --- |
| `connection` | The owned Redis client emitted a connection error. |
| `get`, `set`, `delete` | An ordinary cache operation failed or timed out. |
| `revalidateTag` | Distributed invalidation did not complete inside its budget. Alert on this. |
| `decode` | Redis returned a corrupt entry; Cachekind returned a miss and scheduled deletion. |
| `delete-corrupt` | Best-effort corrupt-entry cleanup failed. The TTL remains the fallback. |
| `encode-value` or `encode` | A value could not be represented safely. |

The warning `Cache value exceeds policy limit` includes `kind`, `valueBytes`,
and `maxValueBytes`. It means the value was deliberately not written.

## What to monitor

At minimum, monitor:

- application latency and error rate;
- regeneration volume or upstream work when Redis misses increase;
- `revalidateTag` errors;
- Redis latency, connection count, memory, eviction count, and availability;
- counts of Cachekind warnings by `operation`;
- `x-nextjs-cache` HIT/MISS behavior on a synthetic public route.

Cachekind does not currently emit per-hit logs or metrics because that would add
work to every request. Derive operational dashboards from Redis, Next.js, and
application telemetry, and benchmark before adding hot-path instrumentation.

## Expected degraded behavior

During a Redis outage:

1. The first failed operation is bounded by its configured timeout.
2. The circuit breaker short-circuits later operations during the cooldown.
3. Next.js regenerates misses using its normal behavior.
4. Cachekind probes Redis after the cooldown and resumes automatically.

Capacity-plan the origin and upstream services for this miss traffic. Cachekind
does not keep a potentially stale local fallback cache.

## Invalidation failures

An ordinary cache read can safely degrade to a miss. Failed invalidation is
different: an existing entry may remain readable until its TTL. Use a longer
`invalidationTimeoutMs`, alert on `revalidateTag`, and retry the application-level
operation when the business workflow requires confirmed invalidation.

## Namespace and cleanup

Cachekind-created keys always have finite TTLs. Build-scoped keys from an old
release expire without a deployment-time scan. Tag keys also expire, with a
configured TTL that must be at least as long as every enabled entry TTL.

Do not operate on Cachekind keys by pattern during normal requests. If an
emergency cleanup is necessary, identify the exact environment namespace and
use your Redis provider's maintenance process outside the application path.
