import { describe, expect, it } from 'vitest'

import { selectByteLruEvictionKeys, sumEntryBytes } from './byteLru'

describe('byte LRU helpers', () => {
  it('sums byte lengths across entries', () => {
    expect(sumEntryBytes([
      { byteLength: 5 },
      { byteLength: 7 },
      { byteLength: 0 },
    ])).toBe(12)
  })

  it('evicts least-recently-used entries until under the byte cap', () => {
    const keys = selectByteLruEvictionKeys([
      { key: 'a', byteLength: 5, lastAccessedAt: 10 },
      { key: 'b', byteLength: 7, lastAccessedAt: 20 },
      { key: 'c', byteLength: 11, lastAccessedAt: 30 },
    ], 15)

    expect(keys).toEqual(['a', 'b'])
  })

  it('does not evict when total bytes are already within the cap', () => {
    const keys = selectByteLruEvictionKeys([
      { key: 'a', byteLength: 5, lastAccessedAt: 10 },
      { key: 'b', byteLength: 7, lastAccessedAt: 20 },
    ], 16)

    expect(keys).toEqual([])
  })
})
