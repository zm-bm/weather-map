import { selectByteLruEvictionKeys } from './byteLru'
import { createPayloadMemoryCache } from './payloadMemoryCache'
import { createPayloadUpdateBuffer } from './payloadUpdateBuffer'
import {
  createPayloadIndexedDb,
  type PayloadCacheMeta,
} from './payloadIndexedDb'

const METADATA_TOUCH_INTERVAL_MS = 60_000
const PENDING_UPDATE_BYTE_LIMIT = 64 * 1024 * 1024

export type PayloadCacheLimits = {
  memoryBytes: number
  persistedBytes: number
}

type PayloadCacheOptions = {
  dbName: string
  storeName: string
  defaultLimits: PayloadCacheLimits
  dbVersion?: number
}

type PayloadCacheWriteArgs = {
  scopeKey: string
  key: string
  payload: ArrayBuffer
}

export type PayloadCache = {
  activateScope(scopeKey: string): Promise<void>
  read(key: string): Promise<ArrayBuffer | null>
  write(args: PayloadCacheWriteArgs): Promise<void>
}

export type PayloadCacheTestControls = {
  flushForTests(): Promise<void>
  resetForTests(): Promise<void>
  setLimitsForTests(limits: Partial<PayloadCacheLimits>): void
}

export function createPayloadCache(
  options: PayloadCacheOptions
): PayloadCache & PayloadCacheTestControls {
  const memoryCache = createPayloadMemoryCache(options.defaultLimits.memoryBytes)
  const pendingUpdates = createPayloadUpdateBuffer(PENDING_UPDATE_BYTE_LIMIT)
  const indexedDb = createPayloadIndexedDb({
    dbName: options.dbName,
    storeName: options.storeName,
    dbVersion: options.dbVersion,
  })
  let activeScopeKey: string | null = null
  let indexedDbByteLimit = normalizeLimitBytes(options.defaultLimits.persistedBytes)
  let queuedPruneScopeKey: string | null = null
  let drainPromise: Promise<void> | null = null

  function shouldRefreshMetadata(
    meta: PayloadCacheMeta,
    accessedAt: number
  ): boolean {
    return accessedAt - meta.lastAccessedAt >= METADATA_TOUCH_INTERVAL_MS
  }

  function didMetadataChange(
    currentMeta: PayloadCacheMeta | null,
    nextMeta: PayloadCacheMeta
  ): boolean {
    if (!currentMeta) return true
    return (
      currentMeta.scopeKey !== nextMeta.scopeKey ||
      currentMeta.byteLength !== nextMeta.byteLength ||
      currentMeta.lastAccessedAt !== nextMeta.lastAccessedAt
    )
  }

  function hasPendingWork(): boolean {
    return queuedPruneScopeKey != null || pendingUpdates.hasPending()
  }

  function createCacheMeta(args: {
    key: string
    scopeKey: string
    payload: ArrayBuffer
    lastAccessedAt: number
  }): PayloadCacheMeta {
    return {
      key: args.key,
      scopeKey: args.scopeKey,
      byteLength: args.payload.byteLength,
      lastAccessedAt: args.lastAccessedAt,
    }
  }

  async function evictIndexedDbToLimit() {
    const persistedMetadata = await indexedDb.listMetadata()
    const evictionKeys = selectByteLruEvictionKeys(
      persistedMetadata,
      indexedDbByteLimit
    )
    await indexedDb.deleteKeys(evictionKeys)
  }

  function startDrain(): Promise<void> {
    if (drainPromise) return drainPromise

    drainPromise = (async () => {
      try {
        while (hasPendingWork()) {
          const pruneScopeKey = queuedPruneScopeKey
          queuedPruneScopeKey = null
          const scopeKey = activeScopeKey
          const updates = pendingUpdates.drain().filter((update) => (
            scopeKey == null || update.meta.scopeKey === scopeKey
          ))

          if (pruneScopeKey != null) {
            await indexedDb.pruneScope(pruneScopeKey)
          }
          if (updates.length === 0) continue

          await indexedDb.writeUpdates(updates)

          const hasPendingPayloads = updates.some((update) => update.payload != null)
          if (hasPendingPayloads) {
            await evictIndexedDbToLimit()
          }
        }
      } finally {
        drainPromise = null
        if (hasPendingWork()) {
          void startDrain()
        }
      }
    })()

    return drainPromise
  }

  async function flushPendingWork() {
    while (drainPromise) {
      await drainPromise
    }
  }

  return {
    async activateScope(scopeKey) {
      if (activeScopeKey === scopeKey) return

      activeScopeKey = scopeKey
      memoryCache.clear()
      pendingUpdates.clear()
      queuedPruneScopeKey = scopeKey
      await startDrain()
    },

    async flushForTests() {
      await flushPendingWork()
    },

    async read(key) {
      const cachedPayload = memoryCache.read(key)
      if (cachedPayload) return cachedPayload

      const { payload, meta } = await indexedDb.readEntry(key)
      if (!payload) return null

      const accessedAt = Date.now()
      const nextMeta = meta && !shouldRefreshMetadata(meta, accessedAt)
        ? meta
        : {
          key,
          scopeKey: meta?.scopeKey ?? activeScopeKey ?? '',
          byteLength: meta?.byteLength ?? payload.byteLength,
          lastAccessedAt: accessedAt,
        }

      memoryCache.write({
        key,
        payload,
        byteLength: nextMeta.byteLength,
        lastAccessedAt: accessedAt,
      })

      if (didMetadataChange(meta, nextMeta)) {
        pendingUpdates.enqueue({
          payload: null,
          meta: nextMeta,
        })
        void startDrain()
      }

      return payload
    },

    async resetForTests() {
      await flushPendingWork()
      memoryCache.clear()
      pendingUpdates.clear()
      activeScopeKey = null
      queuedPruneScopeKey = null
      memoryCache.setLimitBytes(options.defaultLimits.memoryBytes)
      indexedDbByteLimit = normalizeLimitBytes(options.defaultLimits.persistedBytes)
      drainPromise = null
      await indexedDb.reset()
    },

    setLimitsForTests(limits) {
      if (limits.memoryBytes != null) {
        memoryCache.setLimitBytes(limits.memoryBytes)
      }
      if (limits.persistedBytes != null) {
        indexedDbByteLimit = normalizeLimitBytes(limits.persistedBytes)
      }
    },

    async write(args) {
      if (activeScopeKey != null && args.scopeKey !== activeScopeKey) return

      const lastAccessedAt = Date.now()
      const meta = createCacheMeta({
        key: args.key,
        scopeKey: args.scopeKey,
        payload: args.payload,
        lastAccessedAt,
      })

      memoryCache.write({
        key: args.key,
        payload: args.payload,
        byteLength: meta.byteLength,
        lastAccessedAt,
      })
      pendingUpdates.enqueue({
        payload: args.payload,
        meta,
      })
      void startDrain()
    },
  }
}

function normalizeLimitBytes(value: number): number {
  return Math.max(0, value)
}
