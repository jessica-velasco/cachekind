import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { encode } from '../core/codec'
import { resolveOptions } from '../core/config'
import { buildEntryKey } from '../core/keys'
import { logSafely, once, reportSafely } from '../core/observability'
import { createRedisStore } from '../core/store'
import { resolveEntryTtlSeconds } from '../core/ttl'
import type {
  CacheKind,
  CachekindOptions,
  IncrementalCacheEntry,
  IncrementalCacheHandlerClass,
  IncrementalCacheValue,
  IncrementalGetContext,
  IncrementalSetContext,
  NextCacheHandlerOptions,
} from '../types'
import { CACHE_KINDS } from '../types'

function asCacheKind(value: unknown): CacheKind | undefined {
  return typeof value === 'string' &&
    CACHE_KINDS.includes(value as CacheKind)
    ? (value as CacheKind)
    : undefined
}

function headerTags(value: IncrementalCacheValue): string[] {
  const headers = value.headers
  if (!headers || typeof headers !== 'object') return []

  let raw: unknown
  const get = (headers as { get?: unknown }).get
  if (typeof get === 'function') {
    raw = get.call(headers, 'x-next-cache-tags')
  } else {
    const match = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === 'x-next-cache-tags',
    )
    raw = match?.[1]
  }

  const values = Array.isArray(raw) ? raw : [raw]
  return values.flatMap((item) =>
    typeof item === 'string'
      ? item
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
  )
}

function extractTags(
  value: IncrementalCacheValue,
  context?: IncrementalSetContext,
): string[] {
  const contextTags = Array.isArray(context?.tags)
    ? context.tags.filter(
        (tag): tag is string => typeof tag === 'string' && tag.length > 0,
      )
    : []
  return [...new Set([...contextTags, ...headerTags(value)])].sort()
}

function cacheControlFor(
  value: IncrementalCacheValue,
  context?: IncrementalSetContext,
): IncrementalSetContext['cacheControl'] {
  if (context?.cacheControl) return context.cacheControl
  const revalidate = value.revalidate
  return typeof revalidate === 'number' || revalidate === false
    ? { revalidate }
    : undefined
}

export function createIncrementalCacheHandler(
  options: CachekindOptions,
): IncrementalCacheHandlerClass {
  const resolved = resolveOptions(options)
  const store = createRedisStore(resolved)
  let cachedBuildId: string | undefined
  let pendingBuildId: Promise<string> | undefined
  const announceDisabled = once(() => {
    logSafely(resolved.logger, 'info', 'Cachekind is disabled', {
      component: 'cachekind',
      reason: 'redis-disabled',
    })
  })

  function reportHandlerError(
    operation: string,
    error: unknown,
    kind?: CacheKind,
  ): void {
    logSafely(resolved.logger, 'warn', 'Cachekind handler operation failed', {
      component: 'cachekind',
      operation,
      kind,
      error: error instanceof Error ? error.message : String(error),
    })
    reportSafely(resolved.reportError, error, {
      component: 'cachekind',
      operation,
      ...(kind ? { kind } : {}),
    })
  }

  async function resolveBuildId(
    nextOptions: NextCacheHandlerOptions,
  ): Promise<string> {
    if (cachedBuildId) return cachedBuildId
    if (pendingBuildId) return pendingBuildId

    pendingBuildId = (async () => {
      let value: unknown
      if (typeof resolved.buildId === 'function') {
        value = await resolved.buildId()
      } else if (typeof resolved.buildId === 'string') {
        value = resolved.buildId
      } else if (nextOptions.serverDistDir) {
        value = await readFile(
          path.resolve(nextOptions.serverDistDir, '..', 'BUILD_ID'),
          'utf8',
        )
      }

      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(
          'A build ID is required for build-scoped cache entries',
        )
      }
      cachedBuildId = value.trim()
      return cachedBuildId
    })()

    try {
      return await pendingBuildId
    } finally {
      pendingBuildId = undefined
    }
  }

  async function entryKey(
    kind: CacheKind,
    key: string,
    nextOptions: NextCacheHandlerOptions,
  ): Promise<string> {
    const buildId =
      resolved.policies[kind].scope === 'build'
        ? await resolveBuildId(nextOptions)
        : undefined
    return buildEntryKey(resolved, kind, key, buildId)
  }

  return class CachekindIncrementalCacheHandler {
    readonly nextOptions: NextCacheHandlerOptions

    constructor(nextOptions: NextCacheHandlerOptions = {}) {
      this.nextOptions = nextOptions
      if (resolved.redis === false) announceDisabled()
    }

    async get(
      key: string,
      context?: IncrementalGetContext,
    ): Promise<IncrementalCacheEntry | null> {
      const kind = asCacheKind(context?.kind)
      if (!store || !kind || !resolved.policies[kind].enabled) return null

      try {
        const redisKey = await entryKey(kind, key, this.nextOptions)
        const entry = await store.get(
          redisKey,
          resolved.policies[kind].timeoutMs,
        )
        if (!entry || entry.kind !== kind) return null
        return {
          value: entry.value,
          lastModified: entry.lastModified,
          ...(entry.tags.length > 0 ? { tags: [...entry.tags] } : {}),
        }
      } catch (error) {
        reportHandlerError('get-key', error, kind)
        return null
      }
    }

    async set(
      key: string,
      data: IncrementalCacheValue | null,
      context?: IncrementalSetContext,
    ): Promise<void> {
      if (!store) return

      if (data === null) {
        const contextKind = asCacheKind(context?.kind)
        const kinds = contextKind
          ? [contextKind]
          : CACHE_KINDS.filter((kind) => resolved.policies[kind].enabled)
        await Promise.all(
          kinds.map(async (kind) => {
            if (!resolved.policies[kind].enabled) return
            try {
              const redisKey = await entryKey(kind, key, this.nextOptions)
              await store.delete(redisKey, resolved.policies[kind].timeoutMs)
            } catch (error) {
              reportHandlerError('delete-key', error, kind)
            }
          }),
        )
        return
      }

      const kind = asCacheKind(data.kind)
      if (!kind || !resolved.policies[kind].enabled) return
      const policy = resolved.policies[kind]

      let valueBytes: number
      try {
        valueBytes = encode(data).byteLength
      } catch (error) {
        reportHandlerError('encode-value', error, kind)
        return
      }
      if (valueBytes > policy.maxValueBytes) {
        logSafely(resolved.logger, 'warn', 'Cache value exceeds policy limit', {
          component: 'cachekind',
          operation: 'set',
          kind,
          valueBytes,
          maxValueBytes: policy.maxValueBytes,
        })
        return
      }

      try {
        const redisKey = await entryKey(kind, key, this.nextOptions)
        await store.set(
          redisKey,
          {
            value: data,
            lastModified: Date.now(),
            kind,
            tags: extractTags(data, context),
          },
          resolveEntryTtlSeconds(policy, cacheControlFor(data, context)),
          policy.timeoutMs,
        )
      } catch (error) {
        reportHandlerError('set-key', error, kind)
      }
    }

    async revalidateTag(
      tags: string | string[],
      _durations?: { expire?: number },
    ): Promise<void> {
      if (!store) return
      const normalized = (Array.isArray(tags) ? tags : [tags]).filter(
        (tag): tag is string => typeof tag === 'string' && tag.length > 0,
      )
      await store.revalidateTags(normalized)
    }

    resetRequestCache(): void {}
  }
}
