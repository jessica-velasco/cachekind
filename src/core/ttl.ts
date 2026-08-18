import type { ResolvedCachePolicy } from '../types'

export interface CacheControlInput {
  revalidate?: number | false
  expire?: number
}

function usableSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

export function resolveEntryTtlSeconds(
  policy: ResolvedCachePolicy,
  cacheControl?: CacheControlInput,
): number {
  const requested =
    usableSeconds(cacheControl?.expire) ??
    usableSeconds(cacheControl?.revalidate) ??
    policy.defaultTtlSeconds

  return Math.max(1, Math.min(requested, policy.maxTtlSeconds))
}
