'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { encode } = require('../dist/core/codec.js')
const { resolveOptions } = require('../dist/core/config.js')
const { buildTagKey } = require('../dist/core/keys.js')
const { createRedisStore } = require('../dist/core/store.js')

class MemoryTransport {
  values = new Map()
  writes = []
  getCalls = 0
  getManyCalls = 0
  deleteCalls = []
  serverTime = 1_000

  async time() {
    return this.serverTime
  }

  async get(key) {
    this.getCalls += 1
    return this.values.get(key)?.value ?? null
  }

  async getMany(keys) {
    this.getManyCalls += 1
    return keys.map((key) => this.values.get(key)?.value ?? null)
  }

  async set(key, value, options) {
    this.values.set(key, {
      value: Buffer.from(value),
      ttlSeconds: options.ttlSeconds,
    })
    this.writes.push({ key, ttlSeconds: options.ttlSeconds })
  }

  async delete(key) {
    this.values.delete(key)
    this.deleteCalls.push(key)
  }
}

function createMemoryStore(transport, overrides = {}) {
  const config = resolveOptions({
    redis: { transport },
    namespace: 'store-test',
    tagTtlSeconds: 86_400,
    resilience: {
      timeoutMs: 50,
      invalidationTimeoutMs: 100,
      cooldownMs: 500,
      ...overrides.resilience,
    },
  })
  if (overrides.serverTime !== undefined) {
    transport.serverTime = overrides.serverTime
  }
  return createRedisStore(config, {
    breakerNow: overrides.breakerNow,
  })
}

test('stores binary-safe entries and applies a TTL to every created key', async () => {
  const transport = new MemoryTransport()
  const store = createMemoryStore(transport)
  const key = 'store-test:v1:stable:entry:fetch:digest'

  assert.equal(
    await store.set(
      key,
      {
        kind: 'FETCH',
        lastModified: 900,
        tags: ['products', 'products'],
        value: {
          kind: 'FETCH',
          body: Buffer.from([0, 1, 2, 255]),
        },
      },
      60,
    ),
    true,
  )

  const hit = await store.get(key)
  assert.deepEqual(hit.value.body, Buffer.from([0, 1, 2, 255]))
  assert.deepEqual(hit.tags, ['products'])
  assert.equal(hit.createdAt, 1_000)
  assert.equal(transport.getManyCalls, 1)
  assert.deepEqual(transport.writes[0], { key, ttlSeconds: 60 })

  // Equal server timestamps are treated conservatively as invalidated.
  transport.serverTime = 1_000
  assert.equal(await store.revalidateTags(['products']), true)
  assert.deepEqual(transport.writes[1], {
    key: buildTagKey('store-test', 'products'),
    ttlSeconds: 86_400,
  })
  assert.equal(await store.get(key), null)
})

test('treats corrupt entries as misses and deletes them in the background', async () => {
  const transport = new MemoryTransport()
  const store = createMemoryStore(transport)
  const key = 'corrupt-entry'
  transport.values.set(key, { value: Buffer.from('bad'), ttlSeconds: 60 })

  assert.equal(await store.get(key), null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(transport.deleteCalls, [key])
})

test('treats mismatched envelope and Next.js kinds as corrupt', async () => {
  const transport = new MemoryTransport()
  const store = createMemoryStore(transport)
  const key = 'mismatched-kind'
  transport.values.set(key, {
    ttlSeconds: 60,
    value: encode({
      version: 1,
      createdAt: 1_000,
      lastModified: 1_000,
      kind: 'FETCH',
      tags: [],
      value: { kind: 'APP_PAGE', html: '<main>wrong kind</main>' },
    }),
  })

  assert.equal(await store.get(key), null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(transport.deleteCalls, [key])
})

test('a timeout opens the breaker and a late result cannot close it', async () => {
  let now = 1_000
  let resolveLate
  let calls = 0
  const transport = new MemoryTransport()
  transport.get = async () => {
    calls += 1
    if (calls === 1) {
      return new Promise((resolve) => {
        resolveLate = resolve
      })
    }
    return null
  }
  const store = createMemoryStore(transport, {
    breakerNow: () => now,
    resilience: { timeoutMs: 10, cooldownMs: 100 },
  })

  const started = Date.now()
  assert.equal(await store.get('slow'), null)
  assert.ok(Date.now() - started < 100)

  resolveLate(
    encode({
      version: 1,
      createdAt: 1_000,
      lastModified: 1_000,
      kind: 'FETCH',
      tags: ['late-tag'],
      value: { kind: 'FETCH', value: 'late' },
    }),
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(await store.get('short-circuited'), null)
  assert.equal(calls, 1)
  assert.equal(transport.getManyCalls, 0)

  now = 1_101
  assert.equal(await store.get('recovery-probe'), null)
  assert.equal(calls, 2)
})

test('invalid transport batch results cannot produce a cache hit', async () => {
  const transport = new MemoryTransport()
  const store = createMemoryStore(transport)
  const key = 'entry'
  transport.values.set(key, {
    ttlSeconds: 60,
    value: encode({
      version: 1,
      createdAt: 1_000,
      lastModified: 1_000,
      kind: 'FETCH',
      tags: ['tag'],
      value: { kind: 'FETCH', value: 'data' },
    }),
  })
  transport.getMany = async () => []

  assert.equal(await store.get(key), null)
})
