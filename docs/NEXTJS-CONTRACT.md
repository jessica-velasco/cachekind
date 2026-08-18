# Observed Next.js cache-handler contract

These observations come from the production `build && start` probe in `examples/contract-probe`, pinned to Next.js 16.2.10. They are executable evidence for implementation work, not a substitute for rerunning the probe when upgrading Next.js.

## Loading and lifecycle

- Next.js constructs the handler during `next build`, during static generation workers, and at runtime.
- Runtime requests can construct multiple handler instances. Shared client/store state must therefore be explicit and safe to reuse; correctness cannot rely on one class instance.
- `resetRequestCache()` is called around runtime requests and can be called more than once.
- Constructor options observed include `dev`, `fs`, `flushToDisk`, `serverDistDir`, `revalidatedTags`, `maxMemoryCacheSize`, request headers, and `fetchCacheKeyPrefix`.
- Production behavior must be verified with a build and server run. Development mode is not an adequate cache test.
- Configuring an Edge route caused Next.js to analyze and bundle the configured handler into an Edge chunk. Node-only code therefore needs a `process.env.NEXT_RUNTIME === 'edge'` guard that the compiler can eliminate.

## `FETCH`

`get(key, ctx)` receives:

```text
ctx.kind = FETCH
ctx.revalidate
ctx.tags
ctx.softTags
ctx.fetchIdx
ctx.fetchUrl
```

`set(key, data, ctx)` receives a value shaped like:

```text
data.kind = FETCH
data.data = { headers, body, status, url }
data.revalidate
ctx.fetchCache = true
ctx.tags
```

The body observed for `unstable_cache` was a JSON string.

## `APP_PAGE`

`get(key, ctx)` receives `kind`, `isRoutePPREnabled`, and `isFallback`. The observed key for `/` was `/index`.

`set` data includes:

```text
kind = APP_PAGE
html = string
rscData = Buffer
headers
segmentData
```

The set context contains `cacheControl`, `isRoutePPREnabled`, and `isFallback`, but no `tags` array was observed. Cache tags were carried as a comma-separated `x-next-cache-tags` value inside `data.headers`. An implementation that reads only `ctx.tags` silently fails to invalidate pages.

## `APP_ROUTE`

The observed key was the route pathname. The set value contains `status`, a binary `body`, and `headers`. As with `APP_PAGE`, tags were carried in the `x-next-cache-tags` header rather than `ctx.tags`.

## Revalidation

Calling `revalidateTag('probe-data', 'max')` produced:

```text
revalidateTag(['probe-data'], { expire: 31536000 })
```

The handler must accept both a string and an array even though this particular runtime call normalized the value to an array.

## Response verification

For both the page and static route, two sequential production requests produced `x-nextjs-cache: MISS` followed by `x-nextjs-cache: HIT`.

## Open contract checks

- Capture an actual `data: null` call from Next.js, if one can be induced.
- Capture `PAGES` behavior or explicitly declare it unsupported in the first release.
- Keep an Edge route in the probe to detect Node-only dependency leakage during builds.
- Add image contract fixtures only when the image milestone begins.

The generated standalone server has been verified directly. The automated check asserts page and route MISS→HIT, Edge execution, and page invalidation→MISS.
