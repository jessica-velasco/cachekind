'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const Handler = require('../examples/contract-probe/cache-handler.cjs')

test.beforeEach(() => {
  Handler._private.entries.clear()
})

test('stores and returns the raw Next.js value envelope', async () => {
  const handler = new Handler({})
  const value = { kind: 'FETCH', data: { ok: true }, revalidate: 60 }

  await handler.set('key', value, { tags: ['one'] })

  const result = await handler.get('key', { kind: 'FETCH' })
  assert.deepEqual(result.value, value)
  assert.deepEqual(result.tags, ['one'])
  assert.equal(typeof result.lastModified, 'number')
})

test('treats a null set as deletion', async () => {
  const handler = new Handler({})
  await handler.set('key', { kind: 'FETCH' }, { tags: [] })
  await handler.set('key', null, { tags: [] })

  assert.equal(await handler.get('key', { kind: 'FETCH' }), null)
})

test('invalidates entries by any matching tag', async () => {
  const handler = new Handler({})
  await handler.set('first', { kind: 'FETCH' }, { tags: ['one', 'shared'] })
  await handler.set('second', { kind: 'FETCH' }, { tags: ['two'] })

  await handler.revalidateTag(['shared'], { expire: 0 })

  assert.equal(await handler.get('first', { kind: 'FETCH' }), null)
  assert.notEqual(await handler.get('second', { kind: 'FETCH' }), null)
})

test('extracts page and route tags from the Next.js cache header', async () => {
  const handler = new Handler({})
  await handler.set(
    '/page',
    {
      kind: 'APP_PAGE',
      headers: { 'x-next-cache-tags': '_N_T_/page,content' },
    },
    { cacheControl: { revalidate: 60 } },
  )

  await handler.revalidateTag('content')

  assert.equal(await handler.get('/page', { kind: 'APP_PAGE' }), null)
})

test('summarizes binary data without logging its contents', () => {
  assert.deepEqual(Handler._private.summarize(Buffer.alloc(32)), {
    type: 'Buffer',
    bytes: 32,
  })
})
