'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { decode, encode } = require('../dist/core/codec.js')

test('round-trips Next.js-style binary cache values', () => {
  const value = {
    kind: 'APP_PAGE',
    html: '<main>Hello</main>',
    rscData: Buffer.from([0, 1, 2, 255]),
    segmentData: new Map([
      ['/segment', Buffer.from('segment bytes')],
    ]),
    postponed: undefined,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    counter: 9n,
  }

  const encoded = encode(value)
  const decoded = decode(encoded)

  assert.deepEqual(decoded, value)
  assert.ok(Buffer.isBuffer(decoded.rscData))
  assert.ok(Buffer.isBuffer(decoded.segmentData.get('/segment')))
})

test('does not place binary bytes in the JSON metadata', () => {
  const marker = 'RAW_BINARY_MARKER_THAT_MUST_NOT_APPEAR_IN_METADATA'
  const encoded = encode({ body: Buffer.from(marker) })
  const headerLength = encoded.readUInt32BE(4)
  const metadata = encoded.toString('utf8', 8, 8 + headerLength)

  assert.doesNotMatch(metadata, new RegExp(marker))
  assert.ok(encoded.subarray(8 + headerLength).includes(Buffer.from(marker)))
})

test('rejects circular and unsupported values', () => {
  const circular = {}
  circular.self = circular

  assert.throws(() => encode(circular), /circular/)
  assert.throws(() => encode({ fn() {} }), /function/)
})

test('rejects corrupt or truncated entries', () => {
  assert.throws(() => decode(Buffer.from('not-cachekind')), /codec header/)

  const encoded = encode({ body: Buffer.alloc(10) })
  assert.throws(() => decode(encoded.subarray(0, -1)), /Truncated/)
})
