'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

test('public entry stays Node-dependency-free in the Edge runtime', async () => {
  const previousRuntime = process.env.NEXT_RUNTIME
  process.env.NEXT_RUNTIME = 'edge'

  try {
    const { createIncrementalCacheHandler } = require('../dist/index.js')
    const Handler = createIncrementalCacheHandler({
      redis: { url: 'redis://must-not-connect.example:6379' },
      namespace: 'edge-test',
    })
    const handler = new Handler()

    assert.equal(await handler.get('key', { kind: 'FETCH' }), null)
    await handler.set('key', { kind: 'FETCH' })
    await handler.revalidateTag('tag')
    assert.doesNotThrow(() => handler.resetRequestCache())
    assert.equal(
      Object.keys(require.cache).some((file) =>
        file.includes('/@redis/client/'),
      ),
      false,
    )
    assert.equal(
      Object.keys(require.cache).some((file) =>
        file.endsWith('/dist/incremental/handler.js'),
      ),
      false,
    )
  } finally {
    if (previousRuntime === undefined) {
      delete process.env.NEXT_RUNTIME
    } else {
      process.env.NEXT_RUNTIME = previousRuntime
    }
  }
})
