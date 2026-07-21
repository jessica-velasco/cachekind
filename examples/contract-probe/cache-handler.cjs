'use strict'

// Next.js includes the configured handler in Edge chunks. Keeping the Node
// implementation behind this build-time branch prevents Node-only Redis code
// from being evaluated by the Edge runtime.
if (process.env.NEXT_RUNTIME === 'edge') {
  module.exports = class EdgeNoopCacheHandler {
    async get() {
      return null
    }

    async set() {}

    async revalidateTag() {}

    resetRequestCache() {}
  }
} else {
  module.exports = require('./cache-handler-node.cjs')
}

