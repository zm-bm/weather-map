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
import {
  createFakeIndexedDb,
  createFrameManifestFixture,
} from '../test/fixtures'

function payloadBuffer(...bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

async function reloadPayloadFrameCache() {
  vi.resetModules()
  return import('./payloadFrameCache')
}

describe('payload frame cache', () => {
  const manifest = createFrameManifestFixture({ revision: 'rev-a' })
  const nextManifest = createFrameManifestFixture({ revision: 'rev-b' })
  const frameRef = manifest.products.tmp_surface.frames['000']!
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

    const keyA = `${payloadFrameCacheKey(manifest, frameRef)}:a`
    const keyB = `${payloadFrameCacheKey(manifest, frameRef)}:b`
    const keyC = `${payloadFrameCacheKey(manifest, frameRef)}:c`

    await ensurePayloadFrameCacheScope(manifest)
    await writeCachedPayloadFrame({
      manifest,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      manifest,
      key: keyB,
      payload: payloadBuffer(5, 6, 7, 8),
    })

    vi.advanceTimersByTime(60_000)
    await writeCachedPayloadFrame({
      manifest,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    await __flushPayloadFrameCacheForTests()

    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      manifest,
      key: keyC,
      payload: payloadBuffer(9, 10, 11, 12),
    })

    expect(await readCachedPayloadFrame(keyA)).toEqual(payloadBuffer(1, 2, 3, 4))
    expect(await readCachedPayloadFrame(keyB)).toBeNull()
    expect(await readCachedPayloadFrame(keyC)).toEqual(payloadBuffer(9, 10, 11, 12))
  })

  it('reads cached payloads back from IndexedDB after the in-memory cache is reset', async () => {
    const key = payloadFrameCacheKey(manifest, frameRef)

    await ensurePayloadFrameCacheScope(manifest)
    await writeCachedPayloadFrame({
      manifest,
      key,
      payload,
    })
    await __flushPayloadFrameCacheForTests()

    const reloadedCache = await reloadPayloadFrameCache()

    await reloadedCache.ensurePayloadFrameCacheScope(manifest)
    expect(await reloadedCache.readCachedPayloadFrame(key)).toEqual(payload)
  })

  it('coalesces repeated persisted writes for the same cache key', async () => {
    const key = payloadFrameCacheKey(manifest, frameRef)
    const firstPayload = payloadBuffer(1, 2, 3, 4)
    const secondPayload = payloadBuffer(9, 8, 7, 6)

    await ensurePayloadFrameCacheScope(manifest)
    await writeCachedPayloadFrame({
      manifest,
      key,
      payload: firstPayload,
    })
    await writeCachedPayloadFrame({
      manifest,
      key,
      payload: secondPayload,
    })
    await __flushPayloadFrameCacheForTests()

    const reloadedCache = await reloadPayloadFrameCache()

    await reloadedCache.ensurePayloadFrameCacheScope(manifest)
    expect(await reloadedCache.readCachedPayloadFrame(key)).toEqual(secondPayload)
  })

  it('prunes entries that do not match the active cycle revision', async () => {
    const staleKey = payloadFrameCacheKey(manifest, frameRef)
    const freshKey = payloadFrameCacheKey(nextManifest, frameRef)

    await ensurePayloadFrameCacheScope(manifest)
    await writeCachedPayloadFrame({
      manifest,
      key: staleKey,
      payload,
    })

    await ensurePayloadFrameCacheScope(nextManifest)
    await writeCachedPayloadFrame({
      manifest: nextManifest,
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

    const keyA = `${payloadFrameCacheKey(manifest, frameRef)}:a`
    const keyB = `${payloadFrameCacheKey(manifest, frameRef)}:b`
    const keyC = `${payloadFrameCacheKey(manifest, frameRef)}:c`

    await ensurePayloadFrameCacheScope(manifest)
    await writeCachedPayloadFrame({
      manifest,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      manifest,
      key: keyB,
      payload: payloadBuffer(5, 6, 7, 8),
    })

    vi.advanceTimersByTime(60_000)
    await writeCachedPayloadFrame({
      manifest,
      key: keyA,
      payload: payloadBuffer(1, 2, 3, 4),
    })
    await __flushPayloadFrameCacheForTests()

    vi.advanceTimersByTime(1)
    await writeCachedPayloadFrame({
      manifest,
      key: keyC,
      payload: payloadBuffer(9, 10, 11, 12),
    })
    await __flushPayloadFrameCacheForTests()

    const reloadedCache = await reloadPayloadFrameCache()

    reloadedCache.__setPayloadFrameCacheLimitsForTests({
      memoryBytes: 0,
      persistedBytes: 8,
    })
    await reloadedCache.ensurePayloadFrameCacheScope(manifest)

    expect(await reloadedCache.readCachedPayloadFrame(keyA))
      .toEqual(payloadBuffer(1, 2, 3, 4))
    expect(await reloadedCache.readCachedPayloadFrame(keyB)).toBeNull()
    expect(await reloadedCache.readCachedPayloadFrame(keyC))
      .toEqual(payloadBuffer(9, 10, 11, 12))
  })
})
