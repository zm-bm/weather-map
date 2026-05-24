import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeIndexedDb } from '@/test/fixtures'
import {
  createPayloadIndexedDb,
  type PayloadCacheMeta,
} from './payloadIndexedDb'

function payloadBuffer(...bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

function cacheMeta(args: {
  key: string
  scopeKey: string
  lastAccessedAt: number
  byteLength?: number
}): PayloadCacheMeta {
  return {
    key: args.key,
    scopeKey: args.scopeKey,
    byteLength: args.byteLength ?? 4,
    lastAccessedAt: args.lastAccessedAt,
  }
}

describe('payload IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createFakeIndexedDb())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the stored payload when a metadata-only update is written', async () => {
    const db = createPayloadIndexedDb({
      dbName: 'test-payload-cache',
      storeName: 'payloads',
    })
    const payload = payloadBuffer(1, 2, 3, 4)

    await db.writeUpdates([{
      payload,
      meta: cacheMeta({
        key: 'a',
        scopeKey: 'scope-a',
        lastAccessedAt: 10,
      }),
    }])

    await db.writeUpdates([{
      payload: null,
      meta: cacheMeta({
        key: 'a',
        scopeKey: 'scope-a',
        lastAccessedAt: 20,
      }),
    }])

    expect(await db.readEntry('a')).toEqual({
      payload,
      meta: cacheMeta({
        key: 'a',
        scopeKey: 'scope-a',
        lastAccessedAt: 20,
      }),
    })
  })

  it('prunes payloads and metadata outside the active scope', async () => {
    const db = createPayloadIndexedDb({
      dbName: 'test-payload-cache',
      storeName: 'payloads',
    })

    await db.writeUpdates([
      {
        payload: payloadBuffer(1, 2, 3, 4),
        meta: cacheMeta({
          key: 'stale',
          scopeKey: 'scope-a',
          lastAccessedAt: 10,
        }),
      },
      {
        payload: payloadBuffer(5, 6, 7, 8),
        meta: cacheMeta({
          key: 'fresh',
          scopeKey: 'scope-b',
          lastAccessedAt: 20,
        }),
      },
    ])

    await db.pruneScope('scope-b')

    expect(await db.readEntry('stale')).toEqual({
      payload: null,
      meta: null,
    })
    expect(await db.readEntry('fresh')).toEqual({
      payload: payloadBuffer(5, 6, 7, 8),
      meta: cacheMeta({
        key: 'fresh',
        scopeKey: 'scope-b',
        lastAccessedAt: 20,
      }),
    })
  })

  it('returns empty results when IndexedDB is unavailable', async () => {
    vi.unstubAllGlobals()
    const db = createPayloadIndexedDb({
      dbName: 'test-payload-cache',
      storeName: 'payloads',
    })

    expect(await db.readEntry('missing')).toEqual({
      payload: null,
      meta: null,
    })
    expect(await db.listMetadata()).toEqual([])
  })
})
