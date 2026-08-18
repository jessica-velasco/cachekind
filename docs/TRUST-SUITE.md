# Trust suite

Phase 4 turns Cachekind's failure promises into executable checks. The suite is
split by boundary so a CI failure identifies whether the package core, Redis,
or Next.js integration changed.

## Local checks

```sh
npm run verify:trust
```

This runs type checks, unit tests, package-content checks, and the production
Next.js contract probe. The Redis-backed checks additionally require a test
Redis URL:

```sh
CACHEKIND_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:redis
CACHEKIND_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run verify:shared
```

Use an isolated, disposable Redis instance. The tests create random namespaces
and clean up their keys, but they also use `CLIENT PAUSE` to simulate a slow
server.

## Coverage map

| Promise | Executable check |
| --- | --- |
| Page and route MISS→HIT | Production contract probe and shared-cache verifier |
| Two instances share entries and invalidation | Shared-cache verifier |
| Redis commands stay within their time budget | Real Redis pause and unavailable-endpoint tests |
| Recovery happens without restarting Next.js | Real Redis pause recovery test |
| Corrupt values are misses and are removed | Unit and real Redis corruption tests |
| Oversized values do not create keys | Unit and real Redis handler tests |
| Every entry and tag has a finite TTL | Unit and real Redis TTL assertions |
| Rolling builds cannot share build-scoped entries | Unit and real Redis handler tests |
| Standalone output contains Cachekind and its Redis client | Shared-cache verifier artifact assertions |
| Edge output excludes the Node Redis path | Edge entry test and production probe |
| Supported Redis versions | Redis 7.2 and 7.4 CI matrix |
| Supported Next.js 16.2 range | Next.js 16.2.0 and pinned-current CI matrix |
| `rediss://` works with certificate verification | Redis 7.2 TLS CI job |

The runtime library itself never scans Redis. Test-only key listing is used to
prove that rejected writes created no keys and to clean isolated namespaces.
