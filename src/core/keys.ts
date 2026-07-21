import { createHash } from 'node:crypto'
import type { CacheKind, ResolvedCachekindOptions } from '../types'

const KEY_FORMAT_VERSION = 'v1'

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function buildEntryKey(
  options: Pick<ResolvedCachekindOptions, 'namespace' | 'policies'>,
  kind: CacheKind,
  nextKey: string,
  buildId?: string,
): string {
  const policy = options.policies[kind]
  const scope =
    policy.scope === 'stable'
      ? 'stable'
      : `build-${digest(requireBuildId(buildId)).slice(0, 16)}`

  return [
    options.namespace,
    KEY_FORMAT_VERSION,
    scope,
    'entry',
    kind.toLowerCase(),
    digest(nextKey),
  ].join(':')
}

export function buildTagKey(namespace: string, tag: string): string {
  if (tag.length === 0) throw new TypeError('tag cannot be empty')
  return [namespace, KEY_FORMAT_VERSION, 'tag', digest(tag)].join(':')
}

function requireBuildId(buildId: string | undefined): string {
  if (!buildId) {
    throw new Error('A build ID is required for build-scoped cache entries')
  }
  return buildId
}
