# Cachekind

**A resilient Redis cache handler for self-hosted Next.js.**

## Status

- Phase 0 contract spike completed on July 20, 2026 and reverified against the
  current minimum, Next.js 16.3.1.
- Production build, Edge compilation, standalone tracing, page/route/fetch MISS→HIT, and tag invalidation→MISS are covered by an executable probe.
- Phase 1 package/core scaffolding completed: typed public API, policy validation, key/TTL rules, binary codec, safe observability, disabled mode, packaging, and CI.
- Phase 2 Redis adapter and resilience completed: client-neutral transport,
  Node Redis URL adapter, TTL-bound storage, timestamp invalidation, breaker,
  time budgets, late-result protection, lifecycle ownership, and Redis 7.2+
  integration coverage.
- Phase 3 incremental handler completed: supported-kind routing, safe defaults,
  build scoping, TTL policies, header tags, Edge no-op loading, and two-instance
  production verification.
- Phase 4 trust suite completed: production and two-instance verification,
  Redis failure tests, data-integrity checks, standalone tracing assertions,
  and Next.js/Redis/TLS CI coverage.
- Phase 5 alpha preparation is complete; npm publication and a real
  multi-instance deployment remain external release gates.

## Confirmed product decisions

- Safe default: share `FETCH`; require explicit opt-in for `APP_PAGE` and `APP_ROUTE`.
- Initial support floor: Next.js 16.3.1.
- Initial Redis support floor: Redis 7.2.
- Initial Redis transport: standard TCP/TLS URLs. REST-only providers are deferred.
- Project name, npm package, and repository slug: `cachekind`.

## Product goal

Build a small, dependable open-source cache handler for self-hosted Next.js applications running more than one instance. It must work with managed Redis services without requiring server configuration access, and it must let application owners choose cache policy per cache kind.

The defining behavior is simple: Redis is an optimization. If it is absent, slow, unavailable, misconfigured, or contains a corrupt value, the application continues as a cache miss instead of failing or hanging.

## Product position

The first release is for teams running `next start` or standalone Next.js containers behind a load balancer, especially on Kubernetes or another ephemeral platform. Its main benefit is avoiding repeated cold-cache work across instances and deploys. It is not a general Redis framework and it will not try to manage Redis itself.

Success means a user can install the package, add a short handler file and Next.js configuration, set a Redis URL at runtime, and verify a shared hit across two application instances in less than an hour.

## Current Next.js boundary

Next.js 16.3.1 has two distinct cache extension points. We should share one Redis core while exposing separate adapters:

1. `cacheHandler` (singular) handles the incremental/server cache: `FETCH`, `APP_PAGE`, `APP_ROUTE`, `PAGES`, and optionally `IMAGE`. Its stable public methods are `get`, `set`, `revalidateTag`, and `resetRequestCache`.
2. `cacheHandlers` (plural) handles Cache Components such as `'use cache'` and `'use cache: remote'`. Its streamed entry contract uses `get`, `set`, `refreshTags`, `getExpiration`, and `updateTags`.

The first milestone targets the singular incremental cache handler. The Cache Components adapter follows after the core has proven correct. Image caching remains an explicit later opt-in because it has different latency, serialization, and memory behavior.

## MVP scope

### Included

- Next.js 16.3.1 incremental cache contract for `FETCH`, `APP_PAGE`, and `APP_ROUTE`.
- Runtime enable/disable with zero Redis connections when disabled.
- A constructor/factory API; the package never reads ambient environment variables itself.
- Managed-Redis-safe behavior: no `CONFIG` commands, no keyspace notification dependency, no eviction-policy assumption, and a TTL on every package-owned key.
- TLS/auth/database support through a normal Redis connection URL, plus a
  client-neutral transport for reusing application-owned Redis infrastructure.
- Per-kind policy for enablement, key scope, entry TTL bounds, maximum value size, and timeout.
- Build-scoped keys by default for pages/routes, with an explicit stable scope option.
- Binary-safe serialization without turning Buffers into base64 JSON.
- Distributed tag invalidation with Redis as the source of truth.
- Fail-fast operation timeout, circuit breaker, and late-completion protection.
- Injectable structured logger and error reporter; no hot-path `console` output.
- CommonJS-compatible, side-effect-free loading and a documented standalone-output setup.
- Unit tests plus a real two-instance Next.js example and Redis integration tests.

### Deliberately deferred

- `IMAGE` support.
- Cache Components / `'use cache: remote'` adapter.
- In-process L1 caching and pub/sub. The MVP favors correctness and fewer connections. These can be added after measuring the Redis round-trip cost.
- Redis Cluster optimizations, Sentinel discovery, Upstash REST, S3, compression, dashboards, and framework-agnostic APIs.
- Automatic fallback to Next.js internals. Disabled or degraded Redis returns a miss; Next.js remains responsible for regenerating the value.

## Proposed public API

The package should provide a factory that creates the class Next.js expects. Application code owns environment lookup and passes plain options.

```js
const { createIncrementalCacheHandler } = require('cachekind')

module.exports = createIncrementalCacheHandler({
  redis: process.env.REDIS_CACHE_URL
    ? { url: process.env.REDIS_CACHE_URL }
    : false,
  namespace: 'my-app',
  buildId: () => require('node:fs').readFileSync('.next/BUILD_ID', 'utf8').trim(),
  policies: {
    FETCH: { enabled: true, scope: 'build', maxTtlSeconds: 86400 },
    APP_PAGE: { enabled: false },
    APP_ROUTE: { enabled: false },
  },
  resilience: {
    timeoutMs: 1500,
    cooldownMs: 5000,
  },
  logger,
  reportError,
})
```

Projects that already own a Redis client inject a small Cachekind transport:

```js
module.exports = createIncrementalCacheHandler({
  redis: { transport: cacheTransport },
  namespace: 'my-app',
})
```

The URL mode is convenience mode: Cachekind creates, configures, reconnects,
and closes its selected default client. An injected transport is application
owned: Cachekind never connects, reconfigures, or closes it. Cachekind still
enforces its own operation budgets and late-result guards, while the
application remains responsible for the shared client's retry, offline-queue,
socket, TLS, and reconnect behavior.

The public transport boundary contains only the operations the cache needs:
Redis server `time`, binary-safe `get`, cross-slot-safe `getMany`, TTL-bearing
`set`, and `delete`. Server time prevents application clock skew from breaking
timestamp ordering. The batched read must preserve key order and pipeline
independent commands rather than requiring `MGET`, so it also works with Redis
Cluster keys in different hash slots.

Defaults should be conservative:

- Only `FETCH` enabled in the quick-start preset.
- HTML-producing kinds require explicit opt-in and a documentation warning about personalized content.
- Build scope is the default.
- Every entry receives a finite TTL, even when Next.js supplies no useful expiration.
- Oversized values are skipped and reported at warning level rather than causing a request failure.

The exact names are provisional. We will freeze them only after writing three realistic consumer configurations: minimal, Kubernetes/managed Redis, and advanced per-kind policy.

## Storage and invalidation design

Use a versioned key format so migrations can coexist safely:

```text
<namespace>:v1:<scope>:entry:<digest>
<namespace>:v1:tag:<tag-digest>
```

Each entry stores the Next.js value, creation time, kind, and tags as one binary-safe encoded value with a finite Redis TTL. Each tag key stores its latest invalidation timestamp and also has a finite TTL.

On read:

1. Fetch and validate the entry.
2. Fetch invalidation timestamps for its tags in one batched operation.
3. Return a miss if any tag was invalidated after the entry was written.

On tag revalidation, update tag timestamps rather than scanning or deleting all matching entry keys. This avoids `SCAN`, permanent tag hashes, keyspace notifications, pub/sub correctness dependencies, and Redis server configuration. Old invalidated entries disappear through their normal TTL.

This approach intentionally pays at most one additional batched tag lookup per hit. We should benchmark it before considering an L1 cache or pub/sub optimization. Correctness stays in shared storage, so a lost subscriber can never make an instance serve indefinitely stale data.

All multi-key operations must work without assuming keys share a Redis Cluster hash slot. Pipeline independent commands rather than relying on cross-slot transactions or Lua scripts in the first release.

## Resilience contract

- `get`: any Redis, timeout, decode, validation, or version error becomes `null`.
- `set`: never rejects into Next.js. Failed writes are reported and discarded.
- `revalidateTag`: does not silently race a short render-path timeout. It uses a separate, configurable invalidation budget and reports failure prominently because invalidation correctness matters.
- Circuit breaker: after a Redis failure, operations short-circuit to misses during a cooldown; one probe closes the breaker after recovery.
- A timed-out operation cannot close the breaker when it later resolves.
- The Redis client disables the offline queue and request retries by default, attaches an error listener, and continues reconnecting in the background.
- Corrupt entries are reported, deleted best-effort, and treated as misses without opening the availability breaker.

## Package shape

```text
src/
  core/          Redis store, codec, keys, TTL policy, breaker
  incremental/   Next.js singular cacheHandler adapter
  components/    Later streamed Cache Components adapter
  edge/          No-op/edge-safe export if build verification requires it
examples/
  next-app/      Standalone two-instance verification app
test/
  unit/
  integration/
  e2e/
```

Prefer one package until there is evidence that separate packages improve installation or tracing. Publish both CommonJS and type declarations; add ESM only if it does not complicate the out-of-bundle Next.js loading path.

## Delivery phases

### Phase 0 — contract spike

- Pin the minimum supported Next.js patch version in the example.
- Capture the real runtime shapes for every supported kind.
- Verify standalone file tracing, edge compilation, `data: null`, lazy `BUILD_ID`, and development-mode behavior.
- Write contract fixtures that can be rerun against future Next.js versions.

Exit criterion: an intentionally minimal in-memory handler passes production `build && start` behavior for the three MVP kinds.

Status: **completed**. See `docs/NEXTJS-CONTRACT.md` and run `npm run verify:probe`.

### Phase 1 — core and configuration

- Scaffold TypeScript package, linting, tests, release tooling, license, contribution guide, and security policy.
- Implement option validation, key format, TTL policy, codec, and injected observability.
- Add disabled mode and prove that it constructs no Redis client.

Exit criterion: public configuration examples compile and core unit tests cover malformed and boundary values.

Status: **completed**. The root package has zero runtime dependencies, the public configurations type-check, and the core suite covers policy boundaries, binary round trips, corrupt data, key scoping, and disabled behavior.

### Phase 2 — Redis adapter and resilience

- Define and test the client-neutral Redis transport contract, including binary
  values, Redis server time, atomic TTL-bearing writes, and cross-slot-safe
  batched reads.
- Select the default client used only by URL convenience mode through a short
  measured spike; compare connection count, binary APIs, cluster behavior,
  package size, and standalone tracing.
- Implement the default-client transport adapter. Confirm that applications can
  inject and reuse an externally owned transport without Cachekind connecting,
  reconfiguring, or closing it.
- Implement basic-command-only storage and timestamp tag invalidation.
- Implement timeouts, circuit breaker, late-result guard, and client lifecycle.
- Test against Redis 7.2 and a newer 7.x release with TLS-shaped configuration
  where practical.

Exit criterion: Redis loss never delays a request beyond the configured budget,
recovery is automatic, every created key has a TTL, URL mode owns exactly its
own client lifecycle, and injected mode creates no connections and leaves the
application-owned transport open.

Status: **completed**. Unit tests cover timeout budgets, breaker recovery,
late-result isolation, TTL-bearing writes, corrupt data, and ownership. Real
Redis integration tests run against Redis 7.2 and 7.4 in CI, verify entry and
tag TTLs, deliberately pause Redis to verify the request budget and automatic
recovery, and verify that URL mode reuses and closes exactly one connection.
TLS URL parsing and client configuration are covered; an end-to-end
certificate harness remains part of the broader trust suite.

### Phase 3 — incremental handler

- Implement routing and serialization for `FETCH`, `APP_PAGE`, and `APP_ROUTE`.
- Forward `resetRequestCache` behavior if the contract spike shows it is required.
- Add safe defaults and explicit page-cache opt-in.

Exit criterion: two Next.js instances share hits and observe tag/path invalidation; a rolling build does not read incompatible entries.

Status: **completed**. Unit tests cover supported-kind routing, FETCH-only
defaults, explicit page/route opt-in, lazy and discovered build IDs, TTL bounds,
oversized values, null deletion, tag extraction, and rolling-build isolation.
The production standalone verifier starts two Next.js processes against one
Redis instance and observes shared page/route hits plus cross-instance tag and
path invalidation. The same build keeps an Edge route to verify that Node Redis
dependencies are excluded from the Edge runtime.

### Phase 4 — trust suite

- MISS→HIT end-to-end test using `next build && next start`.
- Two-instance invalidation test.
- Redis outage and slow-command chaos tests.
- Corrupt-entry, oversized-entry, TTL, rolling-build, and standalone-output tests.
- Compatibility matrix for supported Next.js and Redis versions.

Exit criterion: CI exercises the failure modes that escaped static review in the earlier experiment.

Status: **completed**. The suite now covers production MISS→HIT behavior,
cross-instance tag and path invalidation, unavailable and paused Redis budgets,
automatic recovery, corrupt-entry cleanup, oversized-write rejection, finite
entry and tag TTLs, rolling-build isolation, and standalone dependency tracing.
CI tests Redis 7.2 and 7.4 plus the minimum Next.js 16.3.1 patch,
and a certificate-verified `rediss://` connection. See `docs/TRUST-SUITE.md`.

### Phase 5 — documentation and first release

- Five-minute quick start and managed-provider recipes.
- Explain cache safety, personalized HTML, build scoping, CDN separation, and operational signals.
- Add migration notes for users of popular existing handlers without disparaging them.
- Publish an alpha below `1.0.0`, validate it in real multi-instance
  deployments, and advance through pre-1.0 versions while the API is still
  allowed to change. Publish `1.0.0` only after the API has survived that
  feedback.

Status: **alpha prepared**. The repository now contains a
five-minute quick start, managed Redis and deployment recipes, cache-safety and
operations guidance, migration notes, release metadata for `0.1.0-alpha.0`, and
a tag-only manual publish workflow. The npm name was available on August 18,
2026. Publication and representative multi-instance deployment feedback remain
required before the project advances toward a stable `1.0.0`.

### Phase 6 — extensions

In priority order, based on demand and measurements:

1. Cache Components / `'use cache: remote'` adapter using the same store and tag model.
2. First-class `IMAGE` policy with binary values, non-blocking writes, and explicit size/TTL controls.
3. Optional bounded L1 plus distributed refresh coordination.
4. Additional connection modes or backends.

## Key decisions to validate early

1. **Package name:** check npm and GitHub availability before we settle it.
2. **Default Redis client:** do a small implementation spike for URL convenience
   mode rather than making one library's assumptions part of the cache core or
   requiring consumers to adopt it.
3. **Minimum Next.js version:** start at 16.3.1 because earlier 16.x patches
   have known high-severity advisories and image and Cache Components contracts
   are actively changing; decide later whether a compatibility adapter for
   older releases is worth the maintenance.
4. **Fallback meaning:** degraded Redis should be a miss, not an attempt to instantiate private Next.js filesystem classes.
5. **Tag TTL:** choose a default long enough that an old cache entry can never outlive its tag invalidation marker. Enforce `tagTtl >= maximumEntryTtl` in configuration.
6. **Entry encoding:** benchmark MessagePack/CBOR versus a tiny custom envelope, including Buffer and streamed-value needs.

## First working session

Before scaffolding, we should agree on only three product choices:

1. Is `FETCH`-only the safest default, with page/route sharing opt-in?
2. Is Next.js 16.3.1+ an acceptable initial support floor?
3. Do we optimize first for standard TCP/TLS Redis URLs (ElastiCache, Azure Managed Redis, Redis Cloud, Upstash TCP) and defer REST-only Redis APIs?

Once those are settled, Phase 0 is the first implementation task. It will give us executable evidence for the Next.js contract before we commit to the Redis schema or public API.
