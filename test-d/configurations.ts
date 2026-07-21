import {
  createIncrementalCacheHandler,
  type CachekindLogger,
  type ErrorReporter,
} from '../src'

// Minimal, explicitly disabled configuration used in build environments.
createIncrementalCacheHandler({
  redis: false,
  namespace: 'marketing-site',
})

// Managed Redis over TLS. FETCH is the only enabled kind by default.
createIncrementalCacheHandler({
  redis: { url: 'rediss://cache.example.com:6380' },
  namespace: 'marketing-site',
  buildId: () => 'deployment-sha',
})

declare const logger: CachekindLogger
declare const reportError: ErrorReporter

// Advanced, explicit HTML sharing for a non-personalized application.
createIncrementalCacheHandler({
  redis: { url: 'redis://cache.internal:6379/1' },
  namespace: 'public-docs',
  buildId: 'deployment-sha',
  policies: {
    FETCH: {
      enabled: true,
      scope: 'stable',
      defaultTtlSeconds: 3_600,
      maxTtlSeconds: 86_400,
      maxValueBytes: 2_097_152,
    },
    APP_PAGE: {
      enabled: true,
      scope: 'build',
      maxTtlSeconds: 86_400,
    },
    APP_ROUTE: { enabled: true, scope: 'build' },
  },
  tagTtlSeconds: 604_800,
  resilience: {
    timeoutMs: 1_500,
    invalidationTimeoutMs: 10_000,
    cooldownMs: 5_000,
  },
  logger,
  reportError,
})
