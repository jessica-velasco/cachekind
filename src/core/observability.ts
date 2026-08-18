import type {
  CachekindLogger,
  ErrorContext,
  ErrorReporter,
  LogFields,
  LogLevel,
} from '../types'

export function logSafely(
  logger: CachekindLogger | undefined,
  level: LogLevel,
  message: string,
  fields?: LogFields,
): void {
  try {
    logger?.[level]?.(message, fields)
  } catch {
    // Observability must never become an availability dependency.
  }
}

export function reportSafely(
  reporter: ErrorReporter | undefined,
  error: unknown,
  context: ErrorContext,
): void {
  if (!reporter) return
  try {
    Promise.resolve(reporter(error, context)).catch(() => undefined)
  } catch {
    // Error reporting must never surface into a request.
  }
}

export function once(callback: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    callback()
  }
}
