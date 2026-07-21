const MAGIC = Buffer.from([0x43, 0x4b, 0x01, 0x00]) // CK, codec v1
const PREFIX_BYTES = MAGIC.byteLength + 4

type EncodedNode =
  | null
  | boolean
  | number
  | string
  | { t: 'undefined' }
  | { t: 'bigint'; v: string }
  | { t: 'date'; v: string }
  | { t: 'buffer'; i: number }
  | { t: 'uint8array'; i: number }
  | { t: 'array'; v: EncodedNode[] }
  | { t: 'map'; v: Array<[EncodedNode, EncodedNode]> }
  | { t: 'object'; v: Array<[string, EncodedNode]> }

interface Header {
  version: 1
  value: EncodedNode
}

function encodeNode(
  value: unknown,
  blobs: Buffer[],
  ancestors: Set<object>,
): EncodedNode {
  if (value === null) return null
  if (value === undefined) return { t: 'undefined' }
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Cachekind cannot encode non-finite numbers')
    }
    return value
  }
  if (typeof value === 'bigint') return { t: 'bigint', v: value.toString() }
  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value !== 'object'
  ) {
    throw new TypeError(`Cachekind cannot encode values of type ${typeof value}`)
  }

  if (Buffer.isBuffer(value)) {
    const i = blobs.push(Buffer.from(value)) - 1
    return { t: 'buffer', i }
  }
  if (value instanceof Uint8Array) {
    const i = blobs.push(Buffer.from(value)) - 1
    return { t: 'uint8array', i }
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Cachekind cannot encode an invalid Date')
    }
    return { t: 'date', v: value.toISOString() }
  }

  if (ancestors.has(value)) {
    throw new TypeError('Cachekind cannot encode circular structures')
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return {
        t: 'array',
        v: value.map((item) => encodeNode(item, blobs, ancestors)),
      }
    }
    if (value instanceof Map) {
      return {
        t: 'map',
        v: [...value.entries()].map(([key, item]) => [
          encodeNode(key, blobs, ancestors),
          encodeNode(item, blobs, ancestors),
        ]),
      }
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Cachekind cannot encode ${value.constructor?.name ?? 'custom objects'}`,
      )
    }
    return {
      t: 'object',
      v: Object.entries(value).map(([key, item]) => [
        key,
        encodeNode(item, blobs, ancestors),
      ]),
    }
  } finally {
    ancestors.delete(value)
  }
}

export function encode(value: unknown): Buffer {
  const blobs: Buffer[] = []
  const header: Header = {
    version: 1,
    value: encodeNode(value, blobs, new Set()),
  }
  const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8')
  const prefix = Buffer.allocUnsafe(PREFIX_BYTES)
  MAGIC.copy(prefix, 0)
  prefix.writeUInt32BE(headerBuffer.byteLength, MAGIC.byteLength)

  const chunks: Buffer[] = [prefix, headerBuffer]
  for (const blob of blobs) {
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(blob.byteLength)
    chunks.push(length, blob)
  }
  return Buffer.concat(chunks)
}

function assertRecord(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid Cachekind ${description}`)
  }
  return value as Record<string, unknown>
}

function decodeNode(node: unknown, blobs: readonly Buffer[]): unknown {
  if (
    node === null ||
    typeof node === 'string' ||
    typeof node === 'boolean' ||
    typeof node === 'number'
  ) {
    return node
  }

  const record = assertRecord(node, 'encoded node')
  const type = record.t
  switch (type) {
    case 'undefined':
      return undefined
    case 'bigint':
      if (typeof record.v !== 'string') throw new TypeError('Invalid bigint node')
      return BigInt(record.v)
    case 'date':
      if (typeof record.v !== 'string') throw new TypeError('Invalid date node')
      return new Date(record.v)
    case 'buffer':
    case 'uint8array': {
      if (!Number.isSafeInteger(record.i)) {
        throw new TypeError('Invalid binary reference')
      }
      const blob = blobs[Number(record.i)]
      if (!blob) throw new RangeError('Binary reference is out of range')
      return type === 'buffer' ? Buffer.from(blob) : new Uint8Array(blob)
    }
    case 'array': {
      if (!Array.isArray(record.v)) throw new TypeError('Invalid array node')
      return record.v.map((item) => decodeNode(item, blobs))
    }
    case 'map': {
      if (!Array.isArray(record.v)) throw new TypeError('Invalid map node')
      return new Map(
        record.v.map((entry) => {
          if (!Array.isArray(entry) || entry.length !== 2) {
            throw new TypeError('Invalid map entry')
          }
          return [decodeNode(entry[0], blobs), decodeNode(entry[1], blobs)]
        }),
      )
    }
    case 'object': {
      if (!Array.isArray(record.v)) throw new TypeError('Invalid object node')
      const result: Record<string, unknown> = {}
      for (const entry of record.v) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== 'string'
        ) {
          throw new TypeError('Invalid object entry')
        }
        Object.defineProperty(result, entry[0], {
          configurable: true,
          enumerable: true,
          writable: true,
          value: decodeNode(entry[1], blobs),
        })
      }
      return result
    }
    default:
      throw new TypeError('Unknown Cachekind encoded node')
  }
}

export function decode<T = unknown>(input: Buffer | Uint8Array): T {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.byteLength < PREFIX_BYTES || !buffer.subarray(0, 4).equals(MAGIC)) {
    throw new TypeError('Invalid Cachekind codec header')
  }

  const headerLength = buffer.readUInt32BE(MAGIC.byteLength)
  const headerEnd = PREFIX_BYTES + headerLength
  if (headerLength === 0 || headerEnd > buffer.byteLength) {
    throw new RangeError('Invalid Cachekind metadata length')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.toString('utf8', PREFIX_BYTES, headerEnd))
  } catch (error) {
    throw new TypeError('Invalid Cachekind metadata JSON', { cause: error })
  }
  const header = assertRecord(parsed, 'metadata')
  if (header.version !== 1 || !('value' in header)) {
    throw new TypeError('Unsupported Cachekind codec version')
  }

  const blobs: Buffer[] = []
  let offset = headerEnd
  while (offset < buffer.byteLength) {
    if (offset + 4 > buffer.byteLength) {
      throw new RangeError('Truncated Cachekind binary length')
    }
    const length = buffer.readUInt32BE(offset)
    offset += 4
    if (offset + length > buffer.byteLength) {
      throw new RangeError('Truncated Cachekind binary value')
    }
    blobs.push(buffer.subarray(offset, offset + length))
    offset += length
  }

  return decodeNode(header.value, blobs) as T
}
