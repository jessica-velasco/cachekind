# Redis client selection

Phase 2 evaluated the base Node Redis client and ioredis for Cachekind's
URL convenience mode. The measurement was taken on July 30, 2026 from the npm
registry metadata for `@redis/client` 6.1.0 and `ioredis` 5.11.1.

| Concern | `@redis/client` 6.1.0 | `ioredis` 5.11.1 |
| --- | --- | --- |
| Standalone connection count | One | One |
| Binary reads | RESP type mapping to `Buffer` | `getBuffer` commands |
| Independent clustered reads | Same-tick commands are auto-pipelined and routed independently | Cluster auto-pipelining groups commands per node |
| Unpacked package size | 4,447,797 bytes | 858,494 bytes |
| Direct dependencies | One | Seven |
| Tracing | Built-in diagnostics-channel and OpenTelemetry surfaces | Application instrumentation around commands |
| Declared Node support | Node 20+ | Node 12.22+ |

Cachekind selected `@redis/client` because it is the official base client,
matches Cachekind's Node 20 floor, has one direct dependency, exposes
standalone tracing, and supports the Redis 7.2+ floor chosen for the first
release. Cachekind depends on `@redis/client`, not the larger `redis` package
that also bundles Redis Stack modules.

The larger unpacked size is accepted for URL convenience mode. Consumers are
not required to standardize on Node Redis: projects using ioredis, a cluster
client, or another Redis-compatible library can inject a
`CachekindRedisTransport`.

The URL adapter creates one lazy connection per Cachekind factory/store,
disables the offline command queue, applies an upper bound to the command
queue, reconnects in the background, installs the required error listener, and
unrefs the socket after connecting. Its integration test verifies that repeated
operations reuse one named connection and that `close()` removes it.

The adapter uses only `TIME`, `GET`, independent pipelined `GET` operations,
`SET` with an atomic `EX` TTL, and `DEL`. Redis server time avoids depending on
synchronized application clocks. The adapter does not require Lua,
transactions, `SCAN`, pub/sub, keyspace notifications, or keys in the same
Redis Cluster hash slot.
