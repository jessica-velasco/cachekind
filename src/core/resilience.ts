export class RedisOperationTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Redis operation exceeded its ${timeoutMs}ms budget`)
    this.name = 'RedisOperationTimeoutError'
  }
}

export class RedisCircuitOpenError extends Error {
  constructor(readonly retryAt: number) {
    super('Redis circuit breaker is open')
    this.name = 'RedisCircuitOpenError'
  }
}

export interface RedisResilienceOptions {
  cooldownMs: number
  now?: () => number
}

export interface RedisOperationGuard {
  throwIfExpired(): void
}

function withTimeout<T>(
  operation: (guard: RedisOperationGuard) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const guard: RedisOperationGuard = {
    throwIfExpired(): void {
      if (expired) throw new RedisOperationTimeoutError(timeoutMs)
    },
  }
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new RedisOperationTimeoutError(timeoutMs))
    }, timeoutMs)
    timer.unref?.()
  })

  // Promise.race installs handlers on both promises. If the Redis command
  // settles after the timeout, its late result is observed but cannot affect
  // the request or the breaker state.
  return Promise.race([
    Promise.resolve().then(() => operation(guard)),
    timeout,
  ]).finally(
    () => {
      if (timer) clearTimeout(timer)
    },
  )
}

export class RedisCircuitBreaker {
  private readonly now: () => number
  private retryAt = 0
  private probeInFlight = false

  constructor(private readonly options: RedisResilienceOptions) {
    this.now = options.now ?? Date.now
  }

  async execute<T>(
    operation: (guard: RedisOperationGuard) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const probe = this.enter()
    try {
      const result = await withTimeout(operation, timeoutMs)
      if (probe) this.retryAt = 0
      return result
    } catch (error) {
      this.retryAt = this.now() + this.options.cooldownMs
      throw error
    } finally {
      if (probe) this.probeInFlight = false
    }
  }

  private enter(): boolean {
    if (this.retryAt === 0) return false

    const now = this.now()
    if (now < this.retryAt || this.probeInFlight) {
      throw new RedisCircuitOpenError(this.retryAt)
    }

    this.probeInFlight = true
    return true
  }
}
