'use strict'

// This handler is intentionally dependency-free. Next.js loads cacheHandler
// outside the application bundle, so this file doubles as a tracing probe for
// the real production contract.
const entries = new Map()

function summarize(value, depth = 0) {
  if (value === null) return null
  if (value === undefined) return 'undefined'
  if (Buffer.isBuffer(value)) return { type: 'Buffer', bytes: value.byteLength }
  if (value instanceof Uint8Array) {
    return { type: value.constructor.name, bytes: value.byteLength }
  }
  if (Array.isArray(value)) {
    if (depth >= 2) return { type: 'Array', length: value.length }
    return value.map((item) => summarize(item, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth >= 2) return { type: value.constructor?.name || 'Object' }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, summarize(item, depth + 1)]),
    )
  }
  if (typeof value === 'string') {
    return value.length > 120
      ? { type: 'string', characters: value.length }
      : value
  }
  return value
}

function probe(event) {
  if (process.env.CACHE_HANDLER_PROBE !== '1') return
  process.stdout.write(`${JSON.stringify({ source: 'cache-handler', ...event })}\n`)
}

function extractTags(data, ctx) {
  const contextTags = Array.isArray(ctx?.tags) ? ctx.tags : []
  const headerTags = data?.headers?.['x-next-cache-tags']
  const valueTags =
    typeof headerTags === 'string'
      ? headerTags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : []

  return [...new Set([...contextTags, ...valueTags])]
}

module.exports = class ContractProbeCacheHandler {
  constructor(options) {
    this.options = options
    probe({ operation: 'constructor', options: summarize(options) })
  }

  async get(key, ctx) {
    const entry = entries.get(key) || null
    probe({
      operation: 'get',
      key,
      ctx: summarize(ctx),
      result: entry ? summarize(entry.value) : null,
    })
    return entry
  }

  async set(key, data, ctx) {
    probe({
      operation: 'set',
      key,
      data: summarize(data),
      ctx: summarize(ctx),
    })

    if (data === null) {
      entries.delete(key)
      return
    }

    entries.set(key, {
      value: data,
      lastModified: Date.now(),
      tags: extractTags(data, ctx),
    })
  }

  async revalidateTag(tags, durations) {
    const normalizedTags = Array.isArray(tags) ? tags : [tags]
    probe({
      operation: 'revalidateTag',
      tags: normalizedTags,
      durations: summarize(durations),
    })

    for (const [key, entry] of entries) {
      if (entry.tags.some((tag) => normalizedTags.includes(tag))) {
        entries.delete(key)
      }
    }
  }

  resetRequestCache() {
    probe({ operation: 'resetRequestCache' })
  }
}

module.exports._private = { entries, extractTags, summarize }
