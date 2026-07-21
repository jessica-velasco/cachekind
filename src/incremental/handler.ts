import { resolveOptions } from '../core/config'
import { logSafely, once } from '../core/observability'
import type {
  CachekindOptions,
  IncrementalCacheHandlerClass,
  IncrementalCacheValue,
  IncrementalGetContext,
  IncrementalSetContext,
  NextCacheHandlerOptions,
} from '../types'

export function createIncrementalCacheHandler(
  options: CachekindOptions,
): IncrementalCacheHandlerClass {
  const resolved = resolveOptions(options)
  const announceDisabled = once(() => {
    logSafely(resolved.logger, 'info', 'Cachekind is disabled', {
      component: 'cachekind',
      reason: 'redis-disabled',
    })
  })

  return class CachekindIncrementalCacheHandler {
    readonly nextOptions: NextCacheHandlerOptions

    constructor(nextOptions: NextCacheHandlerOptions = {}) {
      this.nextOptions = nextOptions
      if (resolved.redis === false) announceDisabled()
    }

    async get(
      _key: string,
      _context?: IncrementalGetContext,
    ): Promise<null> {
      // The Redis-backed implementation arrives in Phase 2. Disabled mode is
      // already production-safe and deliberately behaves as a cache miss.
      return null
    }

    async set(
      _key: string,
      _data: IncrementalCacheValue | null,
      _context?: IncrementalSetContext,
    ): Promise<void> {}

    async revalidateTag(
      _tags: string | string[],
      _durations?: { expire?: number },
    ): Promise<void> {}

    resetRequestCache(): void {}
  }
}
