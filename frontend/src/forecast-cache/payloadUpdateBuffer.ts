import { selectByteLruEvictionKeys } from './byteLru'
import type { PayloadCacheUpdate } from './payloadIndexedDb'

export type PayloadUpdateBuffer = {
  clear(): void
  drain(): PayloadCacheUpdate[]
  enqueue(update: PayloadCacheUpdate): void
  hasPending(): boolean
}

export function createPayloadUpdateBuffer(
  maxPayloadBytes: number
): PayloadUpdateBuffer {
  const updates = new Map<string, PayloadCacheUpdate>()
  let totalPayloadBytes = 0
  const byteLimit = normalizeLimitBytes(maxPayloadBytes)

  function payloadBytes(update: Pick<PayloadCacheUpdate, 'payload'>): number {
    return update.payload?.byteLength ?? 0
  }

  function evictToLimit() {
    if (totalPayloadBytes <= byteLimit) return

    const evictionKeys = selectByteLruEvictionKeys(
      Array.from(updates, ([key, update]) => ({
        key,
        byteLength: payloadBytes(update),
        lastAccessedAt: update.meta.lastAccessedAt,
      })),
      byteLimit
    )

    for (const key of evictionKeys) {
      const update = updates.get(key)
      if (!update) continue
      totalPayloadBytes -= payloadBytes(update)
      updates.delete(key)
    }
  }

  return {
    clear() {
      updates.clear()
      totalPayloadBytes = 0
    },

    drain() {
      const drainedUpdates = Array.from(updates.values())
      updates.clear()
      totalPayloadBytes = 0
      return drainedUpdates
    },

    enqueue(update) {
      const existing = updates.get(update.meta.key)
      if (existing) {
        totalPayloadBytes -= payloadBytes(existing)
      }

      const nextUpdate: PayloadCacheUpdate = {
        payload: update.payload ?? existing?.payload ?? null,
        meta: update.meta,
      }

      updates.set(update.meta.key, nextUpdate)
      totalPayloadBytes += payloadBytes(nextUpdate)
      evictToLimit()
    },

    hasPending() {
      return updates.size > 0
    },
  }
}

function normalizeLimitBytes(value: number): number {
  return Math.max(0, value)
}
