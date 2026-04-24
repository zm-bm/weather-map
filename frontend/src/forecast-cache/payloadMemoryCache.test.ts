import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPayloadMemoryCache } from './payloadMemoryCache'

function payloadBuffer(...bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

describe('payload memory cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-23T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes LRU order when a payload is read', () => {
    const cache = createPayloadMemoryCache(8)
    const payloadA = payloadBuffer(1, 2, 3, 4)
    const payloadB = payloadBuffer(5, 6, 7, 8)
    const payloadC = payloadBuffer(9, 10, 11, 12)

    cache.write({
      key: 'a',
      payload: payloadA,
      byteLength: payloadA.byteLength,
      lastAccessedAt: Date.now(),
    })
    vi.advanceTimersByTime(1)
    cache.write({
      key: 'b',
      payload: payloadB,
      byteLength: payloadB.byteLength,
      lastAccessedAt: Date.now(),
    })

    vi.advanceTimersByTime(1)
    expect(cache.read('a')).toEqual(payloadA)

    vi.advanceTimersByTime(1)
    cache.write({
      key: 'c',
      payload: payloadC,
      byteLength: payloadC.byteLength,
      lastAccessedAt: Date.now(),
    })

    expect(cache.read('a')).toEqual(payloadA)
    expect(cache.read('b')).toBeNull()
    expect(cache.read('c')).toEqual(payloadC)
  })

  it('evicts least-recently-used entries when the byte limit is reduced', () => {
    const cache = createPayloadMemoryCache(8)
    const payloadA = payloadBuffer(1, 2, 3, 4)
    const payloadB = payloadBuffer(5, 6, 7, 8)

    cache.write({
      key: 'a',
      payload: payloadA,
      byteLength: payloadA.byteLength,
      lastAccessedAt: Date.now(),
    })
    vi.advanceTimersByTime(1)
    cache.write({
      key: 'b',
      payload: payloadB,
      byteLength: payloadB.byteLength,
      lastAccessedAt: Date.now(),
    })

    cache.setLimitBytes(4)

    expect(cache.read('a')).toBeNull()
    expect(cache.read('b')).toEqual(payloadB)
  })
})
