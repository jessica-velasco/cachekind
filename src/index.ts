import type {
  CachekindOptions,
  IncrementalCacheHandlerClass,
} from './types'

type NodeHandlerModule = typeof import('./incremental/handler')

export function createIncrementalCacheHandler(
  options: CachekindOptions,
): IncrementalCacheHandlerClass {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return class CachekindEdgeNoopHandler {
      async get(): Promise<null> {
        return null
      }

      async set(): Promise<void> {}

      async revalidateTag(): Promise<void> {}

      resetRequestCache(): void {}
    }
  }

  // Keep Node-only filesystem and Redis dependencies behind the build-time
  // Edge branch. Next.js can eliminate this require from Edge chunks.
  const nodeHandler = require('./incremental/handler') as NodeHandlerModule
  return nodeHandler.createIncrementalCacheHandler(options)
}

export {
  CACHE_KINDS,
  type CachekindRedisTransport,
  type CacheKind,
  type CachePolicy,
  type CacheScope,
  type CachekindLogger,
  type CachekindOptions,
  type ErrorContext,
  type ErrorReporter,
  type IncrementalCacheEntry,
  type IncrementalCacheHandlerClass,
  type IncrementalCacheHandlerInstance,
  type IncrementalCacheValue,
  type RedisConnectionOptions,
  type RedisOptions,
  type RedisTransportOptions,
  type RedisTransportSetOptions,
  type ResilienceOptions,
} from './types'
