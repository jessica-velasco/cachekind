'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { randomUUID } = require('node:crypto')

const { createClient } = require('@redis/client')
const { createIncrementalCacheHandler } = require('../dist/index.js')
const { resolveOptions } = require('../dist/core/config.js')
const { buildEntryKey, buildTagKey } = require('../dist/core/keys.js')
const { createRedisStore } = require('../dist/core/store.js')
const {
  createNodeRedisTransport,
} = require('../dist/node-redis.js')

const redisUrl = process.env.CACHEKIND_TEST_REDIS_URL

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function createVerifier() {
  const verifier = createClient({ url: redisUrl })
  verifier.on('error', () => undefined)
  await verifier.connect()
  return verifier
}

test(
  'Redis 7.2+ stores TTL-bound entries and tags with owned and injected clients',
  { skip: !redisUrl },
  async () => {
    const namespace = `cachekind-test-${randomUUID()}`
    const key = `${namespace}:v1:stable:entry:fetch:test`
    const recoveryKey = `${namespace}:v1:stable:entry:fetch:recovery`
    const tagKey = buildTagKey(namespace, 'products')
    const verifier = await createVerifier()

    try {
      const info = await verifier.info('server')
      const match = /^redis_version:(\d+)\.(\d+)/m.exec(info)
      assert.ok(match)
      const [, majorText, minorText] = match
      const major = Number(majorText)
      const minor = Number(minorText)
      assert.ok(major > 7 || (major === 7 && minor >= 2))

      const config = resolveOptions({
        redis: { url: redisUrl },
        namespace,
        policies: { FETCH: { scope: 'stable' } },
        resilience: {
          timeoutMs: 25,
          invalidationTimeoutMs: 200,
          cooldownMs: 50,
        },
      })
      const store = createRedisStore(config)

      assert.equal(
        await store.set(
          key,
          {
            kind: 'FETCH',
            lastModified: Date.now(),
            tags: ['products'],
            value: { kind: 'FETCH', body: Buffer.from([0, 255]) },
          },
          30,
        ),
        true,
      )
      assert.deepEqual((await store.get(key)).value.body, Buffer.from([0, 255]))
      assert.ok((await verifier.ttl(key)) > 0)
      assert.equal(
        (await verifier.clientList()).filter(
          (client) => client.name === `cachekind:${namespace}`,
        ).length,
        1,
      )

      await wait(2)
      assert.equal(await store.revalidateTags(['products']), true)
      assert.ok((await verifier.ttl(tagKey)) > 0)
      assert.equal(await store.get(key), null)

      assert.equal(
        await store.set(
          recoveryKey,
          {
            kind: 'FETCH',
            lastModified: Date.now(),
            value: { kind: 'FETCH', value: 'recovered' },
          },
          30,
        ),
        true,
      )
      await verifier.sendCommand(['CLIENT', 'PAUSE', '250', 'ALL'])
      const started = Date.now()
      assert.equal(await store.get(recoveryKey), null)
      assert.ok(Date.now() - started < 150)

      const recoveryDeadline = Date.now() + 1_000
      let recovered = null
      while (Date.now() < recoveryDeadline) {
        recovered = await store.get(recoveryKey)
        if (recovered) break
        await wait(50)
      }
      assert.equal(recovered?.value.value, 'recovered')
      await store.close()
      assert.equal(
        (await verifier.clientList()).filter(
          (client) => client.name === `cachekind:${namespace}`,
        ).length,
        0,
      )

      const injectedStore = createRedisStore(
        resolveOptions({
          redis: { transport: createNodeRedisTransport(verifier) },
          namespace,
        }),
      )
      await injectedStore.close()
      assert.equal(verifier.isReady, true)
    } finally {
      await verifier.del([key, recoveryKey, tagKey])
      verifier.destroy()
    }
  },
)

test(
  'an unavailable Redis endpoint stays within the request budget',
  { skip: !redisUrl },
  async () => {
    const unavailable = new URL(redisUrl)
    unavailable.hostname = '127.0.0.1'
    unavailable.port = '1'
    const store = createRedisStore(
      resolveOptions({
        redis: { url: unavailable.toString() },
        namespace: `cachekind-outage-${randomUUID()}`,
        resilience: {
          timeoutMs: 40,
          invalidationTimeoutMs: 80,
          cooldownMs: 50,
        },
      }),
    )

    const started = Date.now()
    assert.equal(await store.get('unreachable'), null)
    assert.ok(
      Date.now() - started < 200,
      'an unreachable Redis endpoint exceeded the failure budget',
    )
    await store.close()
  },
)

test(
  'real Redis corrupt entries become misses and are deleted',
  { skip: !redisUrl },
  async () => {
    const namespace = `cachekind-corrupt-${randomUUID()}`
    const key = `${namespace}:v1:stable:entry:fetch:corrupt`
    const verifier = await createVerifier()
    const store = createRedisStore(
      resolveOptions({
        redis: { transport: createNodeRedisTransport(verifier) },
        namespace,
        policies: { FETCH: { scope: 'stable' } },
      }),
    )

    try {
      await verifier.sendCommand(['SET', key, 'not-a-cachekind-envelope', 'EX', '30'])
      assert.equal(await store.get(key), null)

      const deadline = Date.now() + 500
      while ((await verifier.exists(key)) !== 0 && Date.now() < deadline) {
        await wait(10)
      }
      assert.equal(await verifier.exists(key), 0)
    } finally {
      await verifier.del(key)
      verifier.destroy()
    }
  },
)

test(
  'real Redis skips oversized values and isolates rolling builds',
  { skip: !redisUrl },
  async () => {
    const namespace = `cachekind-handler-${randomUUID()}`
    const verifier = await createVerifier()
    const transport = createNodeRedisTransport(verifier)
    const warnings = []
    const sharedOptions = {
      redis: { transport },
      namespace,
      logger: {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
      },
    }

    try {
      const SmallValueHandler = createIncrementalCacheHandler({
        ...sharedOptions,
        buildId: 'small-value-build',
        policies: { FETCH: { maxValueBytes: 32 } },
      })
      await new SmallValueHandler().set('oversized', {
        kind: 'FETCH',
        data: { body: 'x'.repeat(100) },
      })
      assert.equal(
        (await verifier.keys(`${namespace}:*`)).length,
        0,
        'an oversized value created a Redis key',
      )
      assert.equal(warnings.length, 1)

      const FirstBuild = createIncrementalCacheHandler({
        ...sharedOptions,
        buildId: 'first-build',
      })
      const SecondBuild = createIncrementalCacheHandler({
        ...sharedOptions,
        buildId: 'second-build',
      })
      await new FirstBuild().set('rolling-key', {
        kind: 'FETCH',
        data: { value: 'first-build-value' },
        revalidate: 30,
      })
      assert.notEqual(
        await new FirstBuild().get('rolling-key', { kind: 'FETCH' }),
        null,
      )
      assert.equal(
        await new SecondBuild().get('rolling-key', { kind: 'FETCH' }),
        null,
      )

      const firstConfig = resolveOptions({
        redis: { transport },
        namespace,
        buildId: 'first-build',
      })
      const secondConfig = resolveOptions({
        redis: { transport },
        namespace,
        buildId: 'second-build',
      })
      assert.notEqual(
        buildEntryKey(firstConfig, 'FETCH', 'rolling-key', 'first-build'),
        buildEntryKey(secondConfig, 'FETCH', 'rolling-key', 'second-build'),
      )
    } finally {
      const keys = await verifier.keys(`${namespace}:*`)
      if (keys.length > 0) await verifier.del(keys)
      verifier.destroy()
    }
  },
)
