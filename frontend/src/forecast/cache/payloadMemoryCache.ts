import { selectByteLruEvictionKeys } from './byteLru'

type MemoryCacheEntry = {
  payload: ArrayBuffer
  byteLength: number
  lastAccessedAt: number
}

export type PayloadMemoryCache = {
  clear(): void
  read(key: string): ArrayBuffer | null
  setLimitBytes(limitBytes: number): void
  write(args: {
    key: string
    payload: ArrayBuffer
    byteLength: number
    lastAccessedAt: number
  }): void
}

export function createPayloadMemoryCache(
  limitBytes: number
): PayloadMemoryCache {
  const entries = new Map<string, MemoryCacheEntry>()
  let byteLimit = normalizeLimitBytes(limitBytes)
  let totalBytes = 0

  function evictToLimit() {
    if (totalBytes <= byteLimit) return

    const evictionKeys = selectByteLruEvictionKeys(
      Array.from(entries, ([key, entry]) => ({
        key,
        byteLength: entry.byteLength,
        lastAccessedAt: entry.lastAccessedAt,
      })),
      byteLimit
    )

    for (const key of evictionKeys) {
      const entry = entries.get(key)
      if (!entry) continue
      totalBytes -= entry.byteLength
      entries.delete(key)
    }
  }

  function setEntry(
    key: string,
    entry: MemoryCacheEntry
  ) {
    const existing = entries.get(key)
    if (existing) {
      totalBytes -= existing.byteLength
      entries.delete(key)
    }

    entries.set(key, entry)
    totalBytes += entry.byteLength
    evictToLimit()
  }

  return {
    clear() {
      entries.clear()
      totalBytes = 0
    },

    read(key) {
      const entry = entries.get(key)
      if (!entry) return null

      setEntry(key, {
        payload: entry.payload,
        byteLength: entry.byteLength,
        lastAccessedAt: Date.now(),
      })
      return entry.payload
    },

    setLimitBytes(limit) {
      byteLimit = normalizeLimitBytes(limit)
      evictToLimit()
    },

    write(args) {
      setEntry(args.key, {
        payload: args.payload,
        byteLength: args.byteLength,
        lastAccessedAt: args.lastAccessedAt,
      })
    },
  }
}

function normalizeLimitBytes(value: number): number {
  return Math.max(0, value)
}
