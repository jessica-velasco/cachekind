# Deployment and managed Redis

Cachekind supports standard `redis://` and `rediss://` TCP URLs. REST-only
Redis APIs are not supported in the first release.

## Common production configuration

```js
const { createIncrementalCacheHandler } = require('cachekind')

module.exports = createIncrementalCacheHandler({
  redis: process.env.REDIS_CACHE_URL
    ? { url: process.env.REDIS_CACHE_URL }
    : false,
  namespace: 'storefront',
  policies: {
    FETCH: {
      enabled: true,
      scope: 'build',
      maxTtlSeconds: 86_400,
      timeoutMs: 250,
    },
  },
  resilience: {
    timeoutMs: 250,
    invalidationTimeoutMs: 2_000,
    cooldownMs: 1_000,
  },
  logger,
  reportError,
})
```

Use a different namespace for each application and environment, for example
`storefront-production` and `storefront-staging`. A namespace is not a security
boundary; separate Redis credentials or databases when stronger isolation is
required.

## Redis Cloud

Copy the endpoint, username, and password from the database connection screen.
Use `rediss://` when TLS is enabled and make the provider CA available to the
Node.js trust store when it is not already publicly trusted.

```text
REDIS_CACHE_URL=rediss://default:<encoded-password>@<endpoint>:<port>
```

Redis documents the required connection fields and TLS certificate bundle in
its [connection guide](https://redis.io/docs/latest/operate/rc/databases/connect/)
and [TLS guide](https://redis.io/docs/latest/operate/rc/security/database-security/tls-ssl/).

## Amazon ElastiCache

For a non-cluster primary endpoint, compose a normal URL from the endpoint and
port. Use `rediss://` when in-transit encryption is enabled:

```text
REDIS_CACHE_URL=rediss://:<encoded-auth-token>@<primary-endpoint>:6379
```

Run the application in a network that can reach the cache. AWS documents
[endpoint selection](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Endpoints.html)
and [in-transit encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html).

URL mode creates a normal Redis client; Redis Cluster topology discovery is not
part of the first release. A project that already owns a ready node-redis
cluster can inject `createNodeRedisTransport(cluster)`, but remains responsible
for connecting, reconnecting, and closing it.

## Azure Managed Redis

Use the endpoint and credentials supplied by Azure with a `rediss://` URL. Azure
Managed Redis uses port 10000 for TLS connections and supports TLS 1.2 and 1.3.

```text
REDIS_CACHE_URL=rediss://:<encoded-password>@<name>.<region>.redis.azure.net:10000
```

Confirm the endpoint and policy in Azure rather than copying the placeholder
literally. See Microsoft's [TLS configuration](https://learn.microsoft.com/en-us/azure/redis/tls-configuration)
and [security guidance](https://learn.microsoft.com/en-us/azure/redis/secure-azure-managed-redis).
Cluster-policy deployments require an application-owned cluster transport.

## Kubernetes or Docker

Give every replica the same immutable Next.js build, namespace, and runtime
Redis secret. Do not bake the secret into the image.

```text
REDIS_CACHE_URL=redis://cache-service.cache.svc.cluster.local:6379
```

Use readiness checks for the application itself, not Redis availability:
Cachekind intentionally allows the application to remain available while Redis
is degraded. URL mode unrefs its socket so Redis cannot keep the Node process
alive during shutdown.

## Existing application-owned client

If the application already owns a ready node-redis client or cluster, avoid a
second connection:

```js
const { createIncrementalCacheHandler } = require('cachekind')
const { createNodeRedisTransport } = require('cachekind/node-redis')
const { redisClient } = require('./redis-client')

module.exports = createIncrementalCacheHandler({
  redis: { transport: createNodeRedisTransport(redisClient) },
  namespace: 'storefront-production',
})
```

Cachekind never connects, configures, or closes an injected client. Its retry,
offline-queue, TLS, and lifecycle settings belong to the application.
