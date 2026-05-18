import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __flushPayloadFrameCacheForTests,
  __resetPayloadFrameCacheForTests,
  __setPayloadFrameCacheLimitsForTests,
  ensurePayloadFrameCacheScope,
  payloadFrameCacheKey,
  readCachedPayloadFrame,
  writeCachedPayloadFrame,
} from './payloadFrameCache'
import { resolveActiveRunFrameRef } from '../forecast-manifest'
import {
  createActiveRunFixture,
  createFakeIndexedDb,
  createSingleTimeManifestFixture,
} from '../test/fixtures'

function payloadBuffer(...bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

async function reloadPayloadFrameCache() {
  vi.resetModules()
  return import('./payloadFrameCache')
}

describe('payload frame cache', () => {
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
    await __resetPayloadFrameCacheForTests()
  })

  it('evicts least-recently-used memory entries when the memory cap is exceeded', async () => {
    vi.unstubAllGlobals()
    __setPayloadFrameCacheLimitsForTests({
      memoryBytes: 8,
      persistedBytes: 0,
    })

    const keyA = `${payloadFrameCacheKey(activeRun, frameRef)}:a`
    const keyB = `${payloadFrameCacheKey(activeRun, frameRef)}:b`
    const keyC = `${payloadFrameCacheKey(activeRun, frameRef)}:c`

    await ensurePayloadFrameCacheScope(activeRun)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyB,
      payload: payloadBuffer(5, 6, 7, 8),
    })

    vi.advanceTimersByTime(60_000)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    await __flushPayloadFrameCacheForTests()

    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyC,
      payload: payloadBuffer(9, 10, 11, 12),
    })

    expect(await readCachedPayloadFrame(keyA)).toEqual(payloadBuffer(1, 2, 3, 4))
    expect(await readCachedPayloadFrame(keyB)).toBeNull()
    expect(await readCachedPayloadFrame(keyC)).toEqual(payloadBuffer(9, 10, 11, 12))
  })

  it('reads cached payloads back from IndexedDB after the in-memory cache is reset', async () => {
    const key = payloadFrameCacheKey(activeRun, frameRef)

    await ensurePayloadFrameCacheScope(activeRun)
    await writeCachedPayloadFrame({
      activeRun,
      key,
      payload,
    })
    await __flushPayloadFrameCacheForTests()

    const reloadedCache = await reloadPayloadFrameCache()

    await reloadedCache.ensurePayloadFrameCacheScope(activeRun)
    expect(await reloadedCache.readCachedPayloadFrame(key)).toEqual(payload)
  })

  it('coalesces repeated persisted writes for the same cache key', async () => {
    const key = payloadFrameCacheKey(activeRun, frameRef)
    const firstPayload = payloadBuffer(1, 2, 3, 4)
    const secondPayload = payloadBuffer(9, 8, 7, 6)

    await ensurePayloadFrameCacheScope(activeRun)
    await writeCachedPayloadFrame({
      activeRun,
      key,
      payload: firstPayload,
    })
    await writeCachedPayloadFrame({
      activeRun,
      key,
      payload: secondPayload,
    })
    await __flushPayloadFrameCacheForTests()

    const reloadedCache = await reloadPayloadFrameCache()

    await reloadedCache.ensurePayloadFrameCacheScope(activeRun)
    expect(await reloadedCache.readCachedPayloadFrame(key)).toEqual(secondPayload)
  })

  it('prunes entries that do not match the active cycle revision', async () => {
    const staleKey = payloadFrameCacheKey(activeRun, frameRef)
    const freshKey = payloadFrameCacheKey(nextActiveRun, frameRef)

    await ensurePayloadFrameCacheScope(activeRun)
    await writeCachedPayloadFrame({
      activeRun,
      key: staleKey,
      payload,
    })

    await ensurePayloadFrameCacheScope(nextActiveRun)
    await writeCachedPayloadFrame({
      activeRun: nextActiveRun,
      key: freshKey,
      payload,
    })

    expect(await readCachedPayloadFrame(staleKey)).toBeNull()
    expect(await readCachedPayloadFrame(freshKey)).toEqual(payload)
  })

  it('evicts least-recently-used IndexedDB entries when the persisted cap is exceeded', async () => {
    __setPayloadFrameCacheLimitsForTests({
      memoryBytes: 0,
      persistedBytes: 8,
    })

    const keyA = `${payloadFrameCacheKey(activeRun, frameRef)}:a`
    const keyB = `${payloadFrameCacheKey(activeRun, frameRef)}:b`
    const keyC = `${payloadFrameCacheKey(activeRun, frameRef)}:c`

    await ensurePayloadFrameCacheScope(activeRun)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyB,
      payload: payloadBuffer(5, 6, 7, 8),
    })

    vi.advanceTimersByTime(60_000)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    await __flushPayloadFrameCacheForTests()

    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      activeRun,
      key: keyC,
      payload: payloadBuffer(9, 10, 11, 12),
    })
    await __flushPayloadFrameCacheForTests()

    const reloadedCache = await reloadPayloadFrameCache()

    reloadedCache.__setPayloadFrameCacheLimitsForTests({
      memoryBytes: 0,
      persistedBytes: 8,
    })
    await reloadedCache.ensurePayloadFrameCacheScope(activeRun)

    expect(await reloadedCache.readCachedPayloadFrame(keyA))
      .toEqual(payloadBuffer(1, 2, 3, 4))
    expect(await reloadedCache.readCachedPayloadFrame(keyB)).toBeNull()
    expect(await reloadedCache.readCachedPayloadFrame(keyC))
      .toEqual(payloadBuffer(9, 10, 11, 12))
  })
})
