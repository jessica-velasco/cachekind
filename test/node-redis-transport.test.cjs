'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createNodeRedisTransport,
} = require('../dist/node-redis.js')

test('node-redis adapter uses independent binary commands and atomic TTL writes', async () => {
  const calls = []
  const binary = {
    async get(key) {
      calls.push(['get', key])
      return Buffer.from(key)
    },
    async set(key, value, options) {
      calls.push(['set', key, value, options])
    },
    async del(key) {
      calls.push(['del', key])
      return 1
    },
  }
  const client = {
    async time() {
      return ['1750000000', '123456']
    },
    withTypeMapping() {
      return binary
    },
  }
  const transport = createNodeRedisTransport(client)

  assert.equal(await transport.time(), 1_750_000_000_123_456)
  assert.deepEqual(await transport.getMany(['slot-a', 'slot-b']), [
    Buffer.from('slot-a'),
    Buffer.from('slot-b'),
  ])
  await transport.set('entry', Buffer.from([0, 255]), { ttlSeconds: 42 })
  await transport.delete('entry')

  assert.deepEqual(calls, [
    ['get', 'slot-a'],
    ['get', 'slot-b'],
    [
      'set',
      'entry',
      Buffer.from([0, 255]),
      { expiration: { type: 'EX', value: 42 } },
    ],
    ['del', 'entry'],
  ])
})
