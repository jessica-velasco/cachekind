export const CACHE_KINDS = ['FETCH', 'APP_PAGE', 'APP_ROUTE'] as const

export type CacheKind = (typeof CACHE_KINDS)[number]
export type CacheScope = 'build' | 'stable'
export type MaybePromise<T> = T | Promise<T>

export interface RedisConnectionOptions {
  /** A standard redis:// or rediss:// TCP connection URL. */
  url: string
  transport?: never
}

export interface RedisTransportSetOptions {
  /** The transport must apply this finite TTL as part of the write. */
  ttlSeconds: number
}

/**
 * The minimal binary-safe Redis boundary used by Cachekind.
 *
 * Injected transports are application-owned: Cachekind never connects,
 * reconfigures, or closes them.
 */
export interface CachekindRedisTransport {
  /** Return Redis server time as integer microseconds since the Unix epoch. */
  time(): Promise<number>
  get(key: string): Promise<Uint8Array | null>
  /**
   * Return results in key order. This operation must work when the keys are in
   * different Redis Cluster hash slots; pipeline independent GET commands
   * rather than requiring MGET.
   */
  getMany(keys: readonly string[]): Promise<readonly (Uint8Array | null)[]>
  /** Store a binary value and apply the supplied TTL atomically. */
  set(
    key: string,
    value: Uint8Array,
    options: RedisTransportSetOptions,
  ): Promise<void>
  delete(key: string): Promise<void>
}

export interface RedisTransportOptions {
  /** A ready, application-owned transport. */
  transport: CachekindRedisTransport
  url?: never
}

export type RedisOptions =
  | false
  | RedisConnectionOptions
  | RedisTransportOptions

export interface CachePolicy {
  enabled?: boolean
  scope?: CacheScope
  defaultTtlSeconds?: number
  maxTtlSeconds?: number
  maxValueBytes?: number
  timeoutMs?: number
}

export interface ResilienceOptions {
  timeoutMs?: number
  invalidationTimeoutMs?: number
  cooldownMs?: number
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Readonly<Record<string, unknown>>

export interface CachekindLogger {
  debug?(message: string, fields?: LogFields): void
  info?(message: string, fields?: LogFields): void
  warn?(message: string, fields?: LogFields): void
  error?(message: string, fields?: LogFields): void
}

export interface ErrorContext {
  component: 'cachekind'
  operation: string
  kind?: CacheKind
  key?: string
  details?: LogFields
}

export type ErrorReporter = (
  error: unknown,
  context: ErrorContext,
) => MaybePromise<void>

export interface CachekindOptions {
  /**
   * `false` disables Cachekind, `{ url }` uses a Cachekind-owned client, and
   * `{ transport }` reuses application-owned Redis infrastructure.
   */
  redis: RedisOptions
  namespace: string
  /** Optional override for the BUILD_ID discovered from Next.js at runtime. */
  buildId?: string | (() => MaybePromise<string>)
  policies?: Partial<Record<CacheKind, CachePolicy>>
  tagTtlSeconds?: number
  resilience?: ResilienceOptions
  logger?: CachekindLogger
  reportError?: ErrorReporter
}

export interface ResolvedCachePolicy {
  enabled: boolean
  scope: CacheScope
  defaultTtlSeconds: number
  maxTtlSeconds: number
  maxValueBytes: number
  timeoutMs: number
}

export interface ResolvedResilienceOptions {
  timeoutMs: number
  invalidationTimeoutMs: number
  cooldownMs: number
}

export interface ResolvedCachekindOptions {
  redis:
    | false
    | Readonly<RedisConnectionOptions>
    | Readonly<RedisTransportOptions>
  namespace: string
  buildId?: string | (() => MaybePromise<string>)
  policies: Readonly<Record<CacheKind, Readonly<ResolvedCachePolicy>>>
  tagTtlSeconds: number
  resilience: Readonly<ResolvedResilienceOptions>
  logger?: CachekindLogger
  reportError?: ErrorReporter
}

export interface IncrementalCacheValue {
  kind: string
  [key: string]: unknown
}

export interface IncrementalCacheEntry {
  value: IncrementalCacheValue
  lastModified: number
  tags?: string[]
}

export interface IncrementalGetContext {
  kind?: string
  [key: string]: unknown
}

export interface IncrementalSetContext {
  tags?: string[]
  cacheControl?: {
    revalidate?: number | false
    expire?: number
  }
  [key: string]: unknown
}

export interface NextCacheHandlerOptions {
  serverDistDir?: string
  [key: string]: unknown
}

export interface IncrementalCacheHandlerInstance {
  get(
    key: string,
    context?: IncrementalGetContext,
  ): Promise<IncrementalCacheEntry | null>
  set(
    key: string,
    data: IncrementalCacheValue | null,
    context?: IncrementalSetContext,
  ): Promise<void>
  revalidateTag(
    tags: string | string[],
    durations?: { expire?: number },
  ): Promise<void>
  resetRequestCache(): void
}

export interface IncrementalCacheHandlerClass {
  new (options?: NextCacheHandlerOptions): IncrementalCacheHandlerInstance
}
