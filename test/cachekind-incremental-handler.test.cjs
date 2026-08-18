'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')

const { createIncrementalCacheHandler } = require('../dist/index.js')

class MemoryTransport {
  values = new Map()
  writes = []
  deletes = []
  serverTime = 1_000_000

  async time() {
    this.serverTime += 1
    return this.serverTime
  }

  async get(key) {
    return this.values.get(key)?.value ?? null
  }

  async getMany(keys) {
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
    this.deletes.push(key)
  }
}

function createHandler(transport, overrides = {}) {
  return createIncrementalCacheHandler({
    redis: { transport },
    namespace: overrides.namespace ?? 'handler-test',
    buildId: overrides.buildId ?? 'build-one',
    ...(overrides.policies ? { policies: overrides.policies } : {}),
    ...(overrides.logger ? { logger: overrides.logger } : {}),
  })
}

test('handler instances created by one factory share FETCH entries', async () => {
  const transport = new MemoryTransport()
  const Handler = createHandler(transport)
  const writer = new Handler()
  const reader = new Handler()
  const value = {
    kind: 'FETCH',
    data: { body: Buffer.from([0, 255]) },
    revalidate: 45,
  }

  await writer.set('shared-key', value, { tags: ['products'] })
  const hit = await reader.get('shared-key', { kind: 'FETCH' })

  assert.deepEqual(hit.value, value)
  assert.deepEqual(hit.tags, ['products'])
  assert.equal(transport.writes[0].ttlSeconds, 45)
})

test('page and route caching require explicit opt-in', async () => {
  const transport = new MemoryTransport()
  const Handler = createHandler(transport)
  const handler = new Handler()

  await handler.set('/page', { kind: 'APP_PAGE', html: 'page' })
  await handler.set('/route', {
    kind: 'APP_ROUTE',
    body: Buffer.from('route'),
  })

  assert.equal(transport.writes.length, 0)
  assert.equal(await handler.get('/page', { kind: 'APP_PAGE' }), null)
})

test('opted-in page and route entries use header tags and bounded TTLs', async () => {
  const transport = new MemoryTransport()
  const Handler = createHandler(transport, {
    policies: {
      APP_PAGE: {
        enabled: true,
        defaultTtlSeconds: 120,
        maxTtlSeconds: 120,
      },
      APP_ROUTE: {
        enabled: true,
        defaultTtlSeconds: 90,
        maxTtlSeconds: 90,
      },
    },
  })
  const handler = new Handler()

  await handler.set(
    '/page',
    {
      kind: 'APP_PAGE',
      html: '<main>page</main>',
      headers: { 'X-Next-Cache-Tags': '_N_T_/page, content' },
    },
    {
      tags: ['content', 'context-tag'],
      cacheControl: { expire: 500 },
    },
  )
  await handler.set(
    '/route',
    {
      kind: 'APP_ROUTE',
      body: Buffer.from('route'),
      headers: { 'x-next-cache-tags': '_N_T_/route' },
    },
    { cacheControl: { revalidate: 30 } },
  )

  assert.deepEqual((await handler.get('/page', { kind: 'APP_PAGE' })).tags, [
    '_N_T_/page',
    'content',
    'context-tag',
  ])
  assert.deepEqual(
    transport.writes.slice(0, 2).map((write) => write.ttlSeconds),
    [120, 30],
  )

  await handler.revalidateTag('content')
  assert.equal(await handler.get('/page', { kind: 'APP_PAGE' }), null)
  assert.notEqual(await handler.get('/route', { kind: 'APP_ROUTE' }), null)
})

test('null writes delete the matching cached entry', async () => {
  const transport = new MemoryTransport()
  const Handler = createHandler(transport)
  const handler = new Handler()

  await handler.set('key', { kind: 'FETCH' })
  await handler.set('key', null, { kind: 'FETCH' })

  assert.equal(await handler.get('key', { kind: 'FETCH' }), null)
  assert.equal(transport.deletes.length, 1)
})

test('rolling builds cannot read each other\'s build-scoped entries', async () => {
  const transport = new MemoryTransport()
  const FirstBuild = createHandler(transport, {
    namespace: 'rolling-build',
    buildId: 'first-build',
  })
  const SecondBuild = createHandler(transport, {
    namespace: 'rolling-build',
    buildId: 'second-build',
  })

  await new FirstBuild().set('key', { kind: 'FETCH' })

  assert.notEqual(
    await new FirstBuild().get('key', { kind: 'FETCH' }),
    null,
  )
  assert.equal(
    await new SecondBuild().get('key', { kind: 'FETCH' }),
    null,
  )
})

test('lazy build ID functions run once across handler instances', async () => {
  const transport = new MemoryTransport()
  let calls = 0
  const Handler = createHandler(transport, {
    buildId: async () => {
      calls += 1
      return 'lazy-build'
    },
  })

  await new Handler().set('key', { kind: 'FETCH' })
  await new Handler().get('key', { kind: 'FETCH' })

  assert.equal(calls, 1)
})

test('discovers BUILD_ID from the Next.js server directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cachekind-build-id-'))
  const serverDistDir = path.join(root, '.next', 'server')
  await mkdir(serverDistDir, { recursive: true })
  await writeFile(path.join(root, '.next', 'BUILD_ID'), 'discovered-build\n')

  try {
    const transport = new MemoryTransport()
    const Handler = createIncrementalCacheHandler({
      redis: { transport },
      namespace: 'discovery-test',
    })
    const handler = new Handler({ serverDistDir })

    await handler.set('key', { kind: 'FETCH' })
    assert.notEqual(await handler.get('key', { kind: 'FETCH' }), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('oversized and unsupported values are skipped safely', async () => {
  const warnings = []
  const transport = new MemoryTransport()
  const Handler = createHandler(transport, {
    policies: { FETCH: { maxValueBytes: 32 } },
    logger: {
      warn(message, fields) {
        warnings.push({ message, fields })
      },
    },
  })
  const handler = new Handler()

  await handler.set('large', {
    kind: 'FETCH',
    data: { body: 'x'.repeat(100) },
  })
  await handler.set('unsupported', { kind: 'IMAGE', body: 'image' })

  assert.equal(transport.writes.length, 0)
  assert.equal(warnings.length, 1)
  assert.equal(await handler.get('unsupported', { kind: 'IMAGE' }), null)
})
