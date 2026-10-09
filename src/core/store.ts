import { decode, encode } from './codec'
import { buildTagKey } from './keys'
import { logSafely, reportSafely } from './observability'
import {
  RedisCircuitBreaker,
  RedisCircuitOpenError,
} from './resilience'
import { createOwnedNodeRedisTransport } from './node-redis-transport'
import {
  CACHE_KINDS,
  type CacheKind,
  type CachekindRedisTransport,
  type IncrementalCacheValue,
  type ResolvedCachekindOptions,
} from '../types'

interface StoredEnvelope {
  version: 1
  createdAt: number
  lastModified: number
  kind: CacheKind
  tags: string[]
  value: IncrementalCacheValue
}

export interface CacheStoreWrite {
  value: IncrementalCacheValue
  lastModified: number
  kind: CacheKind
  tags?: readonly string[]
}

export interface CacheStoreEntry {
  value: IncrementalCacheValue
  lastModified: number
  kind: CacheKind
  tags: readonly string[]
  createdAt: number
}

export interface CachekindRedisStore {
  get(key: string, timeoutMs?: number): Promise<CacheStoreEntry | null>
  set(
    key: string,
    entry: CacheStoreWrite,
    ttlSeconds: number,
    timeoutMs?: number,
  ): Promise<boolean>
  delete(key: string, timeoutMs?: number): Promise<boolean>
  revalidateTags(tags: readonly string[]): Promise<boolean>
  close(): Promise<void>
}

interface StoreOptions {
  transport: CachekindRedisTransport
  ownedClose?: () => Promise<void>
  config: Pick<
    ResolvedCachekindOptions,
    | 'namespace'
    | 'tagTtlSeconds'
    | 'resilience'
    | 'logger'
    | 'reportError'
  >
  breakerNow?: () => number
}

type ReadResult =
  | { type: 'miss' }
  | { type: 'stale' }
  | { type: 'hit'; entry: CacheStoreEntry }
  | { type: 'corrupt'; error: unknown }

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return []
  return [...new Set(tags.filter((tag) => tag.length > 0))].sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateEnvelope(value: unknown): StoredEnvelope {
  if (!isRecord(value) || value.version !== 1) {
    throw new TypeError('Invalid Cachekind Redis entry envelope')
  }
  if (
    !Number.isSafeInteger(value.createdAt) ||
    Number(value.createdAt) <= 0 ||
    !Number.isSafeInteger(value.lastModified) ||
    Number(value.lastModified) < 0 ||
    typeof value.kind !== 'string' ||
    !CACHE_KINDS.includes(value.kind as CacheKind) ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === 'string' && tag.length > 0) ||
    !isRecord(value.value) ||
    typeof value.value.kind !== 'string' ||
    value.value.kind !== value.kind
  ) {
    throw new TypeError('Invalid Cachekind Redis entry fields')
  }

  return value as unknown as StoredEnvelope
}

function encodeTimestamp(timestamp: number): Buffer {
  const buffer = Buffer.allocUnsafe(8)
  buffer.writeBigInt64BE(BigInt(timestamp))
  return buffer
}

function decodeTimestamp(value: Uint8Array): number {
  const buffer = Buffer.from(value)
  if (buffer.byteLength !== 8) {
    throw new TypeError('Invalid Cachekind tag timestamp')
  }
  const timestamp = Number(buffer.readBigInt64BE())
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError('Invalid Cachekind tag timestamp')
  }
  return timestamp
}

class RedisStore implements CachekindRedisStore {
  private readonly breaker: RedisCircuitBreaker

  constructor(private readonly options: StoreOptions) {
    this.breaker = new RedisCircuitBreaker({
      cooldownMs: options.config.resilience.cooldownMs,
      ...(options.breakerNow ? { now: options.breakerNow } : {}),
    })
  }

  async get(
    key: string,
    timeoutMs = this.options.config.resilience.timeoutMs,
  ): Promise<CacheStoreEntry | null> {
    let result: ReadResult
    try {
      result = await this.breaker.execute(
        async (guard): Promise<ReadResult> => {
          const encodedEntry = await this.options.transport.get(key)
          guard.throwIfExpired()
          if (encodedEntry === null) return { type: 'miss' }

          let envelope: StoredEnvelope
          try {
            envelope = validateEnvelope(decode(encodedEntry))
          } catch (error) {
            return { type: 'corrupt', error }
          }

          const tagKeys = envelope.tags.map((tag) =>
            buildTagKey(this.options.config.namespace, tag),
          )
          const invalidations =
            tagKeys.length === 0
              ? []
              : await this.options.transport.getMany(tagKeys)
          guard.throwIfExpired()
          if (invalidations.length !== tagKeys.length) {
            return {
              type: 'corrupt',
              error: new TypeError(
                'Redis transport returned an invalid batched read',
              ),
            }
          }

          try {
            const stale = invalidations.some(
              (timestamp) =>
                timestamp !== null &&
                decodeTimestamp(timestamp) >= envelope.createdAt,
            )
            if (stale) return { type: 'stale' }
          } catch (error) {
            return { type: 'corrupt', error }
          }

          return {
            type: 'hit',
            entry: {
              value: envelope.value,
              lastModified: envelope.lastModified,
              kind: envelope.kind,
              tags: envelope.tags,
              createdAt: envelope.createdAt,
            },
          }
        },
        timeoutMs,
      )
    } catch (error) {
      this.reportOperationError('get', error, key)
      return null
    }

    if (result.type === 'corrupt') {
      this.reportOperationError('decode', result.error, key)
      this.deleteInBackground(key)
      return null
    }
    return result.type === 'hit' ? result.entry : null
  }

  async set(
    key: string,
    entry: CacheStoreWrite,
    ttlSeconds: number,
    timeoutMs = this.options.config.resilience.timeoutMs,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      this.reportOperationError(
        'set',
        new TypeError('Redis entry TTL must be a positive safe integer'),
        key,
      )
      return false
    }

    try {
      const result = await this.breaker.execute(
        async (guard): Promise<{ encodeError?: unknown }> => {
          const createdAt = await this.options.transport.time()
          guard.throwIfExpired()

          let encoded: Buffer
          try {
            encoded = encode({
              version: 1,
              createdAt,
              lastModified: entry.lastModified,
              kind: entry.kind,
              tags: normalizeTags(entry.tags),
              value: entry.value,
            } satisfies StoredEnvelope)
          } catch (encodeError) {
            return { encodeError }
          }

          await this.options.transport.set(key, encoded, {
            ttlSeconds,
          })
          return {}
        },
        timeoutMs,
      )
      if (result.encodeError) {
        this.reportOperationError('encode', result.encodeError, key)
        return false
      }
      return true
    } catch (error) {
      this.reportOperationError('set', error, key)
      return false
    }
  }

  async delete(
    key: string,
    timeoutMs = this.options.config.resilience.timeoutMs,
  ): Promise<boolean> {
    try {
      await this.breaker.execute(
        () => this.options.transport.delete(key),
        timeoutMs,
      )
      return true
    } catch (error) {
      this.reportOperationError('delete', error, key)
      return false
    }
  }

  async revalidateTags(tags: readonly string[]): Promise<boolean> {
    const normalized = normalizeTags(tags)
    if (normalized.length === 0) return true

    try {
      await this.breaker.execute(
        async (guard) => {
          const timestamp = encodeTimestamp(
            await this.options.transport.time(),
          )
          guard.throwIfExpired()
          await Promise.all(
            normalized.map((tag) =>
              this.options.transport.set(
                buildTagKey(this.options.config.namespace, tag),
                timestamp,
                { ttlSeconds: this.options.config.tagTtlSeconds },
              ),
            ),
          )
        },
        this.options.config.resilience.invalidationTimeoutMs,
      )
      return true
    } catch (error) {
      this.reportOperationError('revalidateTag', error)
      return false
    }
  }

  async close(): Promise<void> {
    await this.options.ownedClose?.()
  }

  private reportOperationError(
    operation: string,
    error: unknown,
    key?: string,
  ): void {
    if (error instanceof RedisCircuitOpenError) return
    logSafely(this.options.config.logger, 'warn', 'Redis cache operation failed', {
      component: 'cachekind',
      operation,
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    reportSafely(this.options.config.reportError, error, {
      component: 'cachekind',
      operation,
      ...(key ? { key } : {}),
    })
  }

  private deleteInBackground(key: string): void {
    void this.breaker
      .execute(
        () => this.options.transport.delete(key),
        this.options.config.resilience.timeoutMs,
      )
      .catch((error: unknown) => {
        this.reportOperationError('delete-corrupt', error, key)
      })
  }
}

export function createRedisStore(
  config: ResolvedCachekindOptions,
  options: { breakerNow?: () => number } = {},
): CachekindRedisStore | null {
  if (config.redis === false) return null

  if ('transport' in config.redis) {
    return new RedisStore({
      transport: config.redis.transport,
      config,
      ...(options.breakerNow
        ? { breakerNow: options.breakerNow }
        : {}),
    })
  }

  const transport = createOwnedNodeRedisTransport({
    url: config.redis.url,
    clientName: `cachekind:${config.namespace}`,
    connectTimeoutMs: config.resilience.timeoutMs,
    reconnectDelayMs: config.resilience.cooldownMs,
    ...(config.logger ? { logger: config.logger } : {}),
  })
  return new RedisStore({
    transport,
    ownedClose: () => transport.close(),
    config,
    ...(options.breakerNow ? { breakerNow: options.breakerNow } : {}),
  })
}
