import {
  CACHE_KINDS,
  type CacheKind,
  type CachePolicy,
  type CachekindOptions,
  type ResolvedCachePolicy,
  type ResolvedCachekindOptions,
} from '../types'

const MEBIBYTE = 1024 * 1024

const DEFAULT_POLICY: Readonly<Record<CacheKind, ResolvedCachePolicy>> = {
  FETCH: {
    enabled: true,
    scope: 'build',
    defaultTtlSeconds: 3_600,
    maxTtlSeconds: 86_400,
    maxValueBytes: 2 * MEBIBYTE,
    timeoutMs: 1_500,
  },
  APP_PAGE: {
    enabled: false,
    scope: 'build',
    defaultTtlSeconds: 3_600,
    maxTtlSeconds: 86_400,
    maxValueBytes: 5 * MEBIBYTE,
    timeoutMs: 1_500,
  },
  APP_ROUTE: {
    enabled: false,
    scope: 'build',
    defaultTtlSeconds: 3_600,
    maxTtlSeconds: 86_400,
    maxValueBytes: 5 * MEBIBYTE,
    timeoutMs: 1_500,
  },
}

const DEFAULT_TAG_TTL_SECONDS = 7 * 24 * 60 * 60

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return Number(value)
}

function validateNamespace(namespace: unknown): string {
  if (
    typeof namespace !== 'string' ||
    namespace.length < 1 ||
    namespace.length > 64 ||
    !/^[A-Za-z0-9._-]+$/.test(namespace)
  ) {
    throw new TypeError(
      'namespace must be 1-64 characters using letters, numbers, dot, underscore, or hyphen',
    )
  }
  return namespace
}

function validateRedis(
  redis: CachekindOptions['redis'],
): ResolvedCachekindOptions['redis'] {
  if (redis === false) return false
  if (!redis || typeof redis !== 'object') {
    throw new TypeError('redis must be false, { url }, or { transport }')
  }

  const hasUrl = 'url' in redis
  const hasTransport = 'transport' in redis
  if (hasUrl === hasTransport) {
    throw new TypeError('redis must contain exactly one of url or transport')
  }

  if (hasTransport) {
    const transport = redis.transport
    if (
      !transport ||
      typeof transport !== 'object' ||
      typeof transport.time !== 'function' ||
      typeof transport.get !== 'function' ||
      typeof transport.getMany !== 'function' ||
      typeof transport.set !== 'function' ||
      typeof transport.delete !== 'function'
    ) {
      throw new TypeError(
        'redis.transport must implement time, get, getMany, set, and delete',
      )
    }
    // Freeze only Cachekind's wrapper. The application-owned transport may
    // maintain connection state and must not be frozen or otherwise mutated.
    return Object.freeze({ transport })
  }

  if (typeof redis.url !== 'string' || redis.url.length === 0) {
    throw new TypeError('redis.url must be a non-empty string')
  }

  let parsed: URL
  try {
    parsed = new URL(redis.url)
  } catch {
    throw new TypeError('redis.url must be a valid redis:// or rediss:// URL')
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new TypeError('redis.url must use the redis:// or rediss:// protocol')
  }
  if (!parsed.hostname) {
    throw new TypeError('redis.url must include a hostname')
  }

  return Object.freeze({ url: redis.url })
}

function resolvePolicy(
  kind: CacheKind,
  policy: CachePolicy | undefined,
  globalTimeoutMs: number,
): Readonly<ResolvedCachePolicy> {
  const defaults = DEFAULT_POLICY[kind]
  const resolved: ResolvedCachePolicy = {
    enabled: policy?.enabled ?? defaults.enabled,
    scope: policy?.scope ?? defaults.scope,
    defaultTtlSeconds: policy?.defaultTtlSeconds ?? defaults.defaultTtlSeconds,
    maxTtlSeconds: policy?.maxTtlSeconds ?? defaults.maxTtlSeconds,
    maxValueBytes: policy?.maxValueBytes ?? defaults.maxValueBytes,
    timeoutMs: policy?.timeoutMs ?? globalTimeoutMs,
  }

  if (typeof resolved.enabled !== 'boolean') {
    throw new TypeError(`policies.${kind}.enabled must be a boolean`)
  }
  if (resolved.scope !== 'build' && resolved.scope !== 'stable') {
    throw new TypeError(`policies.${kind}.scope must be "build" or "stable"`)
  }

  resolved.defaultTtlSeconds = positiveInteger(
    resolved.defaultTtlSeconds,
    `policies.${kind}.defaultTtlSeconds`,
  )
  resolved.maxTtlSeconds = positiveInteger(
    resolved.maxTtlSeconds,
    `policies.${kind}.maxTtlSeconds`,
  )
  resolved.maxValueBytes = positiveInteger(
    resolved.maxValueBytes,
    `policies.${kind}.maxValueBytes`,
  )
  resolved.timeoutMs = positiveInteger(
    resolved.timeoutMs,
    `policies.${kind}.timeoutMs`,
  )

  if (resolved.defaultTtlSeconds > resolved.maxTtlSeconds) {
    throw new RangeError(
      `policies.${kind}.defaultTtlSeconds cannot exceed maxTtlSeconds`,
    )
  }

  return Object.freeze(resolved)
}

export function resolveOptions(
  options: CachekindOptions,
): Readonly<ResolvedCachekindOptions> {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Cachekind options are required')
  }

  const timeoutMs = positiveInteger(
    options.resilience?.timeoutMs ?? 1_500,
    'resilience.timeoutMs',
  )
  const resilience = Object.freeze({
    timeoutMs,
    invalidationTimeoutMs: positiveInteger(
      options.resilience?.invalidationTimeoutMs ?? 10_000,
      'resilience.invalidationTimeoutMs',
    ),
    cooldownMs: positiveInteger(
      options.resilience?.cooldownMs ?? 5_000,
      'resilience.cooldownMs',
    ),
  })

  const policies = Object.fromEntries(
    CACHE_KINDS.map((kind) => [
      kind,
      resolvePolicy(kind, options.policies?.[kind], timeoutMs),
    ]),
  ) as unknown as Record<CacheKind, Readonly<ResolvedCachePolicy>>

  const tagTtlSeconds = positiveInteger(
    options.tagTtlSeconds ?? DEFAULT_TAG_TTL_SECONDS,
    'tagTtlSeconds',
  )
  const longestEnabledEntryTtl = Math.max(
    ...CACHE_KINDS.filter((kind) => policies[kind].enabled).map(
      (kind) => policies[kind].maxTtlSeconds,
    ),
    0,
  )
  if (tagTtlSeconds < longestEnabledEntryTtl) {
    throw new RangeError(
      'tagTtlSeconds must be greater than or equal to every enabled policy maxTtlSeconds',
    )
  }

  if (
    options.buildId !== undefined &&
    typeof options.buildId !== 'string' &&
    typeof options.buildId !== 'function'
  ) {
    throw new TypeError('buildId must be a string or function')
  }
  if (typeof options.buildId === 'string' && options.buildId.length === 0) {
    throw new TypeError('buildId cannot be an empty string')
  }
  if (options.logger !== undefined && typeof options.logger !== 'object') {
    throw new TypeError('logger must be an object')
  }
  if (
    options.reportError !== undefined &&
    typeof options.reportError !== 'function'
  ) {
    throw new TypeError('reportError must be a function')
  }

  const resolved: ResolvedCachekindOptions = {
    redis: validateRedis(options.redis),
    namespace: validateNamespace(options.namespace),
    policies: Object.freeze(policies),
    tagTtlSeconds,
    resilience,
  }
  if (options.buildId !== undefined) resolved.buildId = options.buildId
  if (options.logger !== undefined) resolved.logger = options.logger
  if (options.reportError !== undefined) resolved.reportError = options.reportError

  return Object.freeze(resolved)
}
