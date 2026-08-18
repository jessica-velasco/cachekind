'use strict'

const { createIncrementalCacheHandler } = require('../../dist/index.js')

module.exports = createIncrementalCacheHandler({
  redis: process.env.CACHEKIND_TEST_REDIS_URL
    ? { url: process.env.CACHEKIND_TEST_REDIS_URL }
    : false,
  namespace: process.env.CACHEKIND_TEST_NAMESPACE || 'cachekind-contract-probe',
  policies: {
    FETCH: { enabled: true, scope: 'build' },
    APP_PAGE: { enabled: true, scope: 'build' },
    APP_ROUTE: { enabled: true, scope: 'build' },
  },
  resilience: {
    timeoutMs: 250,
    invalidationTimeoutMs: 1_000,
    cooldownMs: 250,
  },
})
