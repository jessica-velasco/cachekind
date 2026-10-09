import {
  RESP_TYPES,
  createClient,
  type RedisClientType,
  type RedisClusterType,
} from '@redis/client'
import type {
  CachekindLogger,
  CachekindRedisTransport,
  RedisTransportSetOptions,
} from '../types'
import { logSafely } from './observability'

export type NodeRedisClient = RedisClientType | RedisClusterType

interface BinaryNodeRedisClient {
  get(key: string): Promise<Buffer | null>
  set(
    key: string,
    value: Buffer,
    options: {
      expiration: { type: 'EX'; value: number }
    },
  ): Promise<unknown>
  del(key: string): Promise<number>
}

function redisTimeToMicroseconds(
  result: readonly string[],
): number {
  const seconds = result[0]
  const microseconds = result[1]
  if (seconds === undefined || microseconds === undefined) {
    throw new TypeError('Redis returned an invalid TIME response')
  }
  const timestamp = Number(seconds) * 1_000_000 + Number(microseconds)
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError('Redis returned an invalid TIME response')
  }
  return timestamp
}

function binaryCommands(client: NodeRedisClient): BinaryNodeRedisClient {
  return client.withTypeMapping({
    [RESP_TYPES.BLOB_STRING]: Buffer,
  }) as unknown as BinaryNodeRedisClient
}

/**
 * Adapt an application-owned node-redis client or cluster. The caller remains
 * responsible for connecting, configuring, and closing the client.
 */
export function createNodeRedisTransport(
  client: NodeRedisClient,
): CachekindRedisTransport {
  const binary = binaryCommands(client)
  return {
    async time(): Promise<number> {
      const result = await client.time()
      return redisTimeToMicroseconds(result)
    },
    get: (key) => binary.get(key),
    // node-redis auto-pipelines commands created in the same event-loop tick.
    // Independent GETs remain valid when a cluster routes keys to other slots.
    getMany: (keys) => Promise.all(keys.map((key) => binary.get(key))),
    async set(
      key: string,
      value: Uint8Array,
      options: RedisTransportSetOptions,
    ): Promise<void> {
      await binary.set(key, Buffer.from(value), {
        expiration: { type: 'EX', value: options.ttlSeconds },
      })
    },
    async delete(key: string): Promise<void> {
      await binary.del(key)
    },
  }
}

export interface OwnedNodeRedisTransportOptions {
  url: string
  clientName: string
  connectTimeoutMs: number
  reconnectDelayMs: number
  logger?: CachekindLogger
}

export interface OwnedCachekindRedisTransport
  extends CachekindRedisTransport {
  close(): Promise<void>
}

export function createOwnedNodeRedisTransport(
  options: OwnedNodeRedisTransportOptions,
): OwnedCachekindRedisTransport {
  const client = createClient({
    url: options.url,
    name: options.clientName,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1_000,
    socket: {
      connectTimeout: options.connectTimeoutMs,
      reconnectStrategy: (retries) =>
        Math.min(50 * 2 ** Math.min(retries, 8), options.reconnectDelayMs),
    },
  })
  const transport = createNodeRedisTransport(client)
  let connectPromise: Promise<void> | undefined
  let closed = false

  client.on('error', (error) => {
    logSafely(options.logger, 'warn', 'Redis client error', {
      component: 'cachekind',
      operation: 'connection',
      error: error instanceof Error ? error.message : String(error),
    })
  })

  async function ready(): Promise<void> {
    if (closed) throw new Error('Cachekind Redis transport is closed')
    if (client.isReady) return
    if (!connectPromise) {
      connectPromise = client.connect().then(() => {
        client.unref()
      })
      connectPromise.catch(() => {
        connectPromise = undefined
      })
    }
    await connectPromise
  }

  return {
    async time(): Promise<number> {
      await ready()
      return transport.time()
    },
    async get(key): Promise<Uint8Array | null> {
      await ready()
      return transport.get(key)
    },
    async getMany(keys): Promise<readonly (Uint8Array | null)[]> {
      await ready()
      return transport.getMany(keys)
    },
    async set(key, value, setOptions): Promise<void> {
      await ready()
      await transport.set(key, value, setOptions)
    },
    async delete(key): Promise<void> {
      await ready()
      await transport.delete(key)
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      if (client.isOpen) {
        try {
          await client.close()
        } catch {
          client.destroy()
        }
      }
      try {
        await connectPromise
      } catch {
        // A failed or interrupted initial connection is already closed.
      }
    },
  }
}
