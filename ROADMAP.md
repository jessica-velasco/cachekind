# Cachekind roadmap

Cachekind is prepared for its first `0.1.0-alpha.0` release. The incremental
cache handler, Redis transport, resilience controls, documentation, and
compatibility suite are implemented for Next.js 16.3.8+ and Redis 7.2+.

## Before broader adoption

- Publish the first alpha and configure npm trusted publishing.
- Validate shared caching and invalidation in a representative deployment with
  at least two Next.js instances and managed Redis.
- Exercise a rolling deployment, Redis restart or failover, observability, and
  rollback procedures.
- Gather feedback before stabilizing the public API.

## Possible extensions

Future work will be driven by deployment feedback and measurements:

1. Cache Components and `'use cache: remote'` support.
2. Explicit `IMAGE` caching with appropriate size and latency controls.
3. A bounded local L1 cache with distributed refresh coordination.
4. Additional Redis connection modes or storage backends.

Cachekind will remain below `1.0.0` while its public API and operational
behavior are still being validated. Deferred features should not weaken the
current guarantees: bounded failure behavior, finite TTLs, build isolation,
and shared-storage invalidation correctness.
