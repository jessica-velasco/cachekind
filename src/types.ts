export const CACHE_KINDS = ['FETCH', 'APP_PAGE', 'APP_ROUTE'] as const

export type CacheKind = (typeof CACHE_KINDS)[number]
export type CacheScope = 'build' | 'stable'
export type MaybePromise<T> = T | Promise<T>

export interface RedisConnectionOptions {
  /** A standard redis:// or rediss:// TCP connection URL. */
  url: string
}

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
  /** `false` disables Cachekind without opening any Redis connections. */
  redis: false | RedisConnectionOptions
  namespace: string
  /** Optional override. Runtime discovery from Next.js is implemented later. */
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
  redis: false | Readonly<RedisConnectionOptions>
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
