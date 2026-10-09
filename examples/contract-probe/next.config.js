const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  cacheHandler: require.resolve(
    process.env.CACHEKIND_BUILD_REAL === '1'
      ? './cache-handler-cachekind.cjs'
      : './cache-handler.cjs',
  ),
  cacheMaxMemorySize: 0,
}

module.exports = nextConfig
