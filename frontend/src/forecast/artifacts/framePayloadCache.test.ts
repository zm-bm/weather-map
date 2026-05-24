import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __flushFramePayloadCacheForTests,
  __resetFramePayloadCacheForTests,
  __setFramePayloadCacheLimitsForTests,
  ensureFramePayloadCacheScope,
  framePayloadCacheKey,
  readCachedFramePayload,
  writeCachedFramePayload,
} from './framePayloadCache'
import { resolveActiveRunFrameRef } from '@/forecast/manifest'
import {
  createActiveRunFixture,
  createFakeIndexedDb,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'

function payloadBuffer(...bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

async function reloadFramePayloadCache() {
  vi.resetModules()
  return import('./framePayloadCache')
}

describe('frame payload cache', () => {
  const manifest = createSingleTimeManifestFixture({ revision: 'rev-a' })
  const nextManifest = createSingleTimeManifestFixture({ revision: 'rev-b' })
  const activeRun = createActiveRunFixture(manifest)
  const nextActiveRun = createActiveRunFixture(nextManifest)
  const frameRef = resolveActiveRunFrameRef({
    activeRun,
    artifactId: 'tmp_surface',
    hourToken: '000',
    kind: 'scalar',
  })
  const payload = payloadBuffer(1, 2, 3, 4)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-23T00:00:00Z'))
    vi.stubGlobal('indexedDB', createFakeIndexedDb())
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await __resetFramePayloadCacheForTests()
  })

  it('evicts least-recently-used memory entries when the memory cap is exceeded', async () => {
    vi.unstubAllGlobals()
    __setFramePayloadCacheLimitsForTests({
      memoryBytes: 8,
      persistedBytes: 0,
    })

    const keyA = `${framePayloadCacheKey(activeRun, frameRef)}:a`
    const keyB = `${framePayloadCacheKey(activeRun, frameRef)}:b`
    const keyC = `${framePayloadCacheKey(activeRun, frameRef)}:c`

    await ensureFramePayloadCacheScope(activeRun)
    await writeCachedFramePayload({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    vi.advanceTimersByTime(1)
    await writeCachedFramePayload({
      activeRun,
      key: keyB,
      payload: payloadBuffer(5, 6, 7, 8),
    })

    vi.advanceTimersByTime(60_000)
    await writeCachedFramePayload({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    await __flushFramePayloadCacheForTests()

    vi.advanceTimersByTime(1)
    await writeCachedFramePayload({
      activeRun,
      key: keyC,
      payload: payloadBuffer(9, 10, 11, 12),
    })

    expect(await readCachedFramePayload(keyA)).toEqual(payloadBuffer(1, 2, 3, 4))
    expect(await readCachedFramePayload(keyB)).toBeNull()
    expect(await readCachedFramePayload(keyC)).toEqual(payloadBuffer(9, 10, 11, 12))
  })

  it('reads cached payloads back from IndexedDB after the in-memory cache is reset', async () => {
    const key = framePayloadCacheKey(activeRun, frameRef)

    await ensureFramePayloadCacheScope(activeRun)
    await writeCachedFramePayload({
      activeRun,
      key,
      payload,
    })
    await __flushFramePayloadCacheForTests()

    const reloadedCache = await reloadFramePayloadCache()

    await reloadedCache.ensureFramePayloadCacheScope(activeRun)
    expect(await reloadedCache.readCachedFramePayload(key)).toEqual(payload)
  })

  it('coalesces repeated persisted writes for the same cache key', async () => {
    const key = framePayloadCacheKey(activeRun, frameRef)
    const firstPayload = payloadBuffer(1, 2, 3, 4)
    const secondPayload = payloadBuffer(9, 8, 7, 6)

    await ensureFramePayloadCacheScope(activeRun)
    await writeCachedFramePayload({
      activeRun,
      key,
      payload: firstPayload,
    })
    await writeCachedFramePayload({
      activeRun,
      key,
      payload: secondPayload,
    })
    await __flushFramePayloadCacheForTests()

    const reloadedCache = await reloadFramePayloadCache()

    await reloadedCache.ensureFramePayloadCacheScope(activeRun)
    expect(await reloadedCache.readCachedFramePayload(key)).toEqual(secondPayload)
  })

  it('prunes entries that do not match the active cycle revision', async () => {
    const staleKey = framePayloadCacheKey(activeRun, frameRef)
    const freshKey = framePayloadCacheKey(nextActiveRun, frameRef)

    await ensureFramePayloadCacheScope(activeRun)
    await writeCachedFramePayload({
      activeRun,
      key: staleKey,
      payload,
    })

    await ensureFramePayloadCacheScope(nextActiveRun)
    await writeCachedFramePayload({
      activeRun: nextActiveRun,
      key: freshKey,
      payload,
    })

    expect(await readCachedFramePayload(staleKey)).toBeNull()
    expect(await readCachedFramePayload(freshKey)).toEqual(payload)
  })

  it('evicts least-recently-used IndexedDB entries when the persisted cap is exceeded', async () => {
    __setFramePayloadCacheLimitsForTests({
      memoryBytes: 0,
      persistedBytes: 8,
    })

    const keyA = `${framePayloadCacheKey(activeRun, frameRef)}:a`
    const keyB = `${framePayloadCacheKey(activeRun, frameRef)}:b`
    const keyC = `${framePayloadCacheKey(activeRun, frameRef)}:c`

    await ensureFramePayloadCacheScope(activeRun)
    await writeCachedFramePayload({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    vi.advanceTimersByTime(1)
    await writeCachedFramePayload({
      activeRun,
      key: keyB,
      payload: payloadBuffer(5, 6, 7, 8),
    })

    vi.advanceTimersByTime(60_000)
    await writeCachedFramePayload({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    await __flushFramePayloadCacheForTests()

    vi.advanceTimersByTime(1)
    await writeCachedFramePayload({
      activeRun,
      key: keyC,
      payload: payloadBuffer(9, 10, 11, 12),
    })
    await __flushFramePayloadCacheForTests()

    const reloadedCache = await reloadFramePayloadCache()

    reloadedCache.__setFramePayloadCacheLimitsForTests({
      memoryBytes: 0,
      persistedBytes: 8,
    })
    await reloadedCache.ensureFramePayloadCacheScope(activeRun)

    expect(await reloadedCache.readCachedFramePayload(keyA))
      .toEqual(payloadBuffer(1, 2, 3, 4))
    expect(await reloadedCache.readCachedFramePayload(keyB)).toBeNull()
    expect(await reloadedCache.readCachedFramePayload(keyC))
      .toEqual(payloadBuffer(9, 10, 11, 12))
  })
})
