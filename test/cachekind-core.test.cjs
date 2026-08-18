'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createIncrementalCacheHandler } = require('../dist/index.js')
const { resolveOptions } = require('../dist/core/config.js')
const { buildEntryKey, buildTagKey } = require('../dist/core/keys.js')
const { logSafely, reportSafely } = require('../dist/core/observability.js')
const { resolveEntryTtlSeconds } = require('../dist/core/ttl.js')

test('build-scoped keys change between builds without exposing source keys', () => {
  const options = resolveOptions({ redis: false, namespace: 'my-app' })
  const first = buildEntryKey(options, 'FETCH', 'secret-source-key', 'build-one')
  const second = buildEntryKey(options, 'FETCH', 'secret-source-key', 'build-two')

  assert.notEqual(first, second)
  assert.doesNotMatch(first, /secret-source-key|build-one/)
  assert.match(first, /^my-app:v1:build-[a-f0-9]{16}:entry:fetch:[a-f0-9]{64}$/)
})

test('stable keys do not depend on a build ID', () => {
  const options = resolveOptions({
    redis: false,
    namespace: 'my-app',
    policies: { FETCH: { scope: 'stable' } },
  })

  assert.equal(
    buildEntryKey(options, 'FETCH', 'key'),
    buildEntryKey(options, 'FETCH', 'key', 'ignored-build'),
  )
})

test('tag keys are stable and hide raw tags', () => {
  const key = buildTagKey('my-app', 'customer:private-id')
  assert.match(key, /^my-app:v1:tag:[a-f0-9]{64}$/)
  assert.doesNotMatch(key, /customer|private-id/)
})

test('TTL resolution prefers expire and caps every value', () => {
  const policy = resolveOptions({ redis: false, namespace: 'app' }).policies.FETCH

  assert.equal(resolveEntryTtlSeconds(policy, { revalidate: 30, expire: 90 }), 90)
  assert.equal(
    resolveEntryTtlSeconds(policy, { expire: policy.maxTtlSeconds * 2 }),
    policy.maxTtlSeconds,
  )
  assert.equal(resolveEntryTtlSeconds(policy, { revalidate: false }), 3_600)
})

test('disabled handler always misses and emits one informational signal', async () => {
  const messages = []
  const Handler = createIncrementalCacheHandler({
    redis: false,
    namespace: 'app',
    logger: {
      info(message, fields) {
        messages.push({ message, fields })
      },
    },
  })

  const first = new Handler({})
  const second = new Handler({})
  assert.equal(await first.get('key', { kind: 'FETCH' }), null)
  await first.set('key', { kind: 'FETCH' }, { tags: ['tag'] })
  await second.revalidateTag('tag')

  assert.equal(messages.length, 1)
  assert.equal(messages[0].fields.reason, 'redis-disabled')
})

test('observability hooks cannot break the request path', () => {
  assert.doesNotThrow(() =>
    logSafely(
      { error: () => { throw new Error('logger failure') } },
      'error',
      'message',
    ),
  )
  assert.doesNotThrow(() =>
    reportSafely(
      () => { throw new Error('reporter failure') },
      new Error('cache failure'),
      { component: 'cachekind', operation: 'get' },
    ),
  )
})
