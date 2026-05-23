import { describe, expect, it } from 'vitest'

import { createLruCache } from './lruCache'

describe('createLruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = createLruCache<number>(2)

    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)

    cache.set('c', 3)

    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })
})
