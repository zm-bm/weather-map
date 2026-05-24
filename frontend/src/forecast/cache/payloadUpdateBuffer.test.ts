import { describe, expect, it } from 'vitest'

import type { PayloadCacheMeta } from './payloadIndexedDb'
import { createPayloadUpdateBuffer } from './payloadUpdateBuffer'

function payloadBuffer(...bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

function cacheMeta(args: {
  key: string
  lastAccessedAt: number
  byteLength?: number
  scopeKey?: string
}): PayloadCacheMeta {
  return {
    key: args.key,
    scopeKey: args.scopeKey ?? 'scope-a',
    byteLength: args.byteLength ?? 4,
    lastAccessedAt: args.lastAccessedAt,
  }
}

describe('payload update buffer', () => {
  it('keeps the latest metadata while preserving the buffered payload', () => {
    const buffer = createPayloadUpdateBuffer(8)
    const payload = payloadBuffer(1, 2, 3, 4)

    buffer.enqueue({
      payload,
      meta: cacheMeta({ key: 'a', lastAccessedAt: 10 }),
    })
    buffer.enqueue({
      payload: null,
      meta: cacheMeta({ key: 'a', lastAccessedAt: 20 }),
    })

    expect(buffer.drain()).toEqual([{
      payload,
      meta: cacheMeta({ key: 'a', lastAccessedAt: 20 }),
    }])
  })

  it('evicts the least-recently-updated payloads when the byte cap is exceeded', () => {
    const buffer = createPayloadUpdateBuffer(4)

    buffer.enqueue({
      payload: payloadBuffer(1, 2, 3, 4),
      meta: cacheMeta({ key: 'a', lastAccessedAt: 10 }),
    })
    buffer.enqueue({
      payload: payloadBuffer(5, 6, 7, 8),
      meta: cacheMeta({ key: 'b', lastAccessedAt: 20 }),
    })

    expect(buffer.drain()).toEqual([{
      payload: payloadBuffer(5, 6, 7, 8),
      meta: cacheMeta({ key: 'b', lastAccessedAt: 20 }),
    }])
  })
})
