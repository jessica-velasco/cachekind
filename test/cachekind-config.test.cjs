'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveOptions } = require('../dist/core/config.js')

test('uses conservative per-kind defaults', () => {
  const resolved = resolveOptions({ redis: false, namespace: 'example-app' })

  assert.equal(resolved.policies.FETCH.enabled, true)
  assert.equal(resolved.policies.APP_PAGE.enabled, false)
  assert.equal(resolved.policies.APP_ROUTE.enabled, false)
  assert.equal(resolved.policies.FETCH.scope, 'build')
  assert.ok(resolved.tagTtlSeconds >= resolved.policies.FETCH.maxTtlSeconds)
  assert.ok(Object.isFrozen(resolved))
  assert.ok(Object.isFrozen(resolved.policies.FETCH))
})

test('accepts standard Redis TCP and TLS URLs', () => {
  assert.equal(
    resolveOptions({
      redis: { url: 'redis://cache.internal:6379/2' },
      namespace: 'app',
    }).redis.url,
    'redis://cache.internal:6379/2',
  )
  assert.equal(
    resolveOptions({
      redis: { url: 'rediss://user:secret@cache.example.com:6380' },
      namespace: 'app',
    }).redis.url,
    'rediss://user:secret@cache.example.com:6380',
  )
})

test('rejects unsupported connection protocols', () => {
  assert.throws(
    () =>
      resolveOptions({
        redis: { url: 'https://redis.example.com' },
        namespace: 'app',
      }),
    /redis:\/\/ or rediss:\/\//,
  )
})

test('rejects unsafe namespaces', () => {
  for (const namespace of ['', 'contains spaces', 'contains:colon']) {
    assert.throws(
      () => resolveOptions({ redis: false, namespace }),
      /namespace/,
    )
  }
})

test('enforces TTL policy boundaries', () => {
  assert.throws(
    () =>
      resolveOptions({
        redis: false,
        namespace: 'app',
        policies: {
          FETCH: { defaultTtlSeconds: 101, maxTtlSeconds: 100 },
        },
      }),
    /cannot exceed/,
  )

  assert.throws(
    () =>
      resolveOptions({
        redis: false,
        namespace: 'app',
        tagTtlSeconds: 100,
      }),
    /tagTtlSeconds/,
  )
})

test('allows a larger policy on a disabled kind without inflating tag TTL', () => {
  const resolved = resolveOptions({
    redis: false,
    namespace: 'app',
    tagTtlSeconds: 86_400,
    policies: {
      APP_PAGE: { enabled: false, maxTtlSeconds: 604_800 },
    },
  })

  assert.equal(resolved.policies.APP_PAGE.maxTtlSeconds, 604_800)
})
