# Cache safety

Redis makes a cached result available to every application instance. It does
not make an unsafe result safe to share.

## What is shared by default

Cachekind enables only `FETCH` by default. Even then, application code remains
responsible for ensuring a cached function or request does not place one user's
data under a key that another user can reuse.

Do not put session-specific, tenant-specific, permission-filtered, or otherwise
personal data in a shared cache unless the cache key fully and intentionally
partitions that data. Avoid secrets and authorization decisions entirely.

## Page and route output

`APP_PAGE` and `APP_ROUTE` are disabled by default because a mistake can expose
a complete response. Enable them only for output that is public and independent
of cookies, authorization headers, request identity, tenant, geography, and
other user-specific inputs.

```js
policies: {
  APP_PAGE: { enabled: true, scope: 'build' },
  APP_ROUTE: { enabled: true, scope: 'build' },
}
```

Treat an opt-in as a security review, not merely a performance setting. Test
authenticated and anonymous requests separately before rollout.

## Build scope and stable scope

Build scope is the default. The Redis key includes a digest of Next.js's
`BUILD_ID`, so a rolling deployment cannot read an entry written by another
build. All instances of one release must run the same build artifact or use the
same explicit `buildId`.

Stable scope deliberately shares entries across builds:

```js
policies: {
  FETCH: { scope: 'stable' },
}
```

Use it only when the value and its interpretation remain compatible across
releases. Pages and routes should normally remain build-scoped.

## Redis is not an authorization boundary

Protect Redis with network controls, authentication, TLS where appropriate,
and a dedicated credential. Cachekind needs `TIME`, `GET`, `SET`, and `DEL`.
It does not require `SCAN`, `CONFIG`, Lua scripts, pub/sub, keyspace
notifications, or cross-slot transactions.

Every Cachekind-created entry and tag key receives a finite TTL. A corrupt
entry becomes a miss and is deleted best-effort, but that behavior is recovery,
not protection against an attacker who can write to Redis.

## CDN caching is separate

Cachekind controls Next.js's server-side incremental cache. A CDN in front of
Next.js is another cache with its own keys and TTLs. Calling `revalidateTag()`
or `revalidatePath()` updates Cachekind's Redis state; it does not purge an
already cached CDN response.

Preserve Next.js's response headers and configure CDN caching independently.
See the official [Next.js CDN caching guide](https://nextjs.org/docs/app/guides/cdn-caching).
