import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createConfigFixture,
  createDeferred,
  createFakeIndexedDb,
  createSingleTimeManifestFixture,
  createSignalFixture,
} from '@/test/fixtures'
import {
  createFetchArrayBufferResponse,
  createFetchErrorResponse,
  stubFetchArrayBufferOnce,
} from '@/test/fetch'
import {
  __flushPayloadCacheForTests,
  __resetPayloadCacheForTests,
  __setPayloadCacheLimitsForTests,
} from './payloadCache'
import { readArtifactPayload } from './payload'

const BASE_MANIFEST = createSingleTimeManifestFixture({ frameIds: ['000'] })
const BASE_ACTIVE_RUN = createActiveRunFixture(BASE_MANIFEST)
const BASE_LATEST_RUN = BASE_ACTIVE_RUN.latest
const SCALAR_ARTIFACT = BASE_LATEST_RUN.artifacts.tmp_surface
const VECTOR_ARTIFACT = BASE_LATEST_RUN.artifacts.wind10m_uv

function payloadArgs(args: {
  activeRun?: typeof BASE_ACTIVE_RUN
  artifact?: typeof SCALAR_ARTIFACT | typeof VECTOR_ARTIFACT
  frameId?: string
  signal?: AbortSignal
} = {}) {
  const artifact = args.artifact ?? SCALAR_ARTIFACT
  return {
    config: createConfigFixture(),
    activeRun: args.activeRun ?? BASE_ACTIVE_RUN,
    frameId: args.frameId ?? '000',
    artifact,
    signal: args.signal ?? createSignalFixture(),
  }
}

afterEach(() => {
  __setPayloadCacheLimitsForTests({
    memoryBytes: 128 * 1024 * 1024,
    persistedBytes: 384 * 1024 * 1024,
  })
  vi.unstubAllGlobals()
  vi.useRealTimers()
  return __resetPayloadCacheForTests()
})

describe('readArtifactPayload', () => {
  it('loads a payload buffer', async () => {
    stubFetchArrayBufferOnce(new Uint8Array([1, 2, 3, 4]).buffer)

    const payload = await readArtifactPayload(payloadArgs())

    expect(payload.byteLength).toBe(4)
  })

  it('resolves payload URLs from active run metadata', async () => {
    const fetchMock = stubFetchArrayBufferOnce(new Uint8Array([1, 2, 3, 4]).buffer)

    await readArtifactPayload(payloadArgs())

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/runs/gfs/2026041312/20260413T120000Z-abcdef12/payloads/000/tmp_surface.i8.bin'
    )
  })

  it('uses compact run payload refs when present', async () => {
    const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
      run: {
        ...BASE_LATEST_RUN.run,
        run_id: '20260413T120000Z-abcdef12',
        payload_root: 'runs/gfs/2026041312/20260413T120000Z-abcdef12/payloads',
      },
      artifacts: {
        tmp_surface: {
          ...SCALAR_ARTIFACT,
          payload_file: 'tmp_surface.i8.bin',
        },
      },
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    }))
    const fetchMock = stubFetchArrayBufferOnce(new Uint8Array([1, 2, 3, 4]).buffer)

    await readArtifactPayload(payloadArgs({
      activeRun,
      artifact: activeRun.latest.artifacts.tmp_surface,
    }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/runs/gfs/2026041312/20260413T120000Z-abcdef12/payloads/000/tmp_surface.i8.bin'
    )
  })

  it('uses the in-memory cache for repeated manifest-scoped loads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = payloadArgs()

    await readArtifactPayload(args)
    await readArtifactPayload(args)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('evicts memory payloads through the configured cache limit', async () => {
    vi.useFakeTimers()
    const payload = new Uint8Array([1, 2, 3, 4]).buffer
    const fetchMock = vi.fn().mockResolvedValue(createFetchArrayBufferResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    __setPayloadCacheLimitsForTests({
      memoryBytes: 4,
      persistedBytes: 0,
    })
    const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
      frameIds: ['000', '003'],
    }))

    await readArtifactPayload(payloadArgs({ activeRun, frameId: '000' }))
    vi.advanceTimersByTime(1)
    await readArtifactPayload(payloadArgs({ activeRun, frameId: '003' }))
    vi.advanceTimersByTime(1)
    await readArtifactPayload(payloadArgs({ activeRun, frameId: '000' }))

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reads persisted payloads after the payload cache module reloads', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDb())
    const payload = new Uint8Array([1, 2, 3, 4]).buffer
    const fetchMock = vi.fn().mockResolvedValue(createFetchArrayBufferResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    __setPayloadCacheLimitsForTests({
      memoryBytes: 0,
      persistedBytes: 128,
    })
    const args = payloadArgs()

    await readArtifactPayload(args)
    await __flushPayloadCacheForTests()
    vi.resetModules()
    const reloadedPayload = await import('./payload')
    const reloadedCache = await import('./payloadCache')

    try {
      await reloadedPayload.readArtifactPayload(args)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      await reloadedCache.__resetPayloadCacheForTests()
    }
  })

  it('dedupes parallel loads for the same frame payload', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]).buffer
    const response = createDeferred<ArrayBuffer>()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => response.promise,
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = payloadArgs()
    const firstLoad = readArtifactPayload(args)
    const secondLoad = readArtifactPayload(args)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    response.resolve(payload)

    await expect(firstLoad).resolves.toBe(payload)
    await expect(secondLoad).resolves.toBe(payload)
  })

  it('lets an aborted joining caller reject while the shared payload fetch completes', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]).buffer
    const response = createDeferred<ArrayBuffer>()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => response.promise,
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstController = new AbortController()
    const secondController = new AbortController()

    const firstLoad = readArtifactPayload(payloadArgs({
      signal: firstController.signal,
    }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const secondLoad = readArtifactPayload(payloadArgs({
      signal: secondController.signal,
    }))
    secondController.abort()
    response.resolve(payload)

    await expect(secondLoad).rejects.toMatchObject({ name: 'AbortError' })
    await expect(firstLoad).resolves.toBe(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails on fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found')))

    await expect(
      readArtifactPayload(payloadArgs())
    ).rejects.toThrow('Failed to fetch scalar payload: 404 Not Found')
  })

  it('fails when payload byte length does not match the manifest index', async () => {
    stubFetchArrayBufferOnce(new Uint8Array([1, 2, 3, 4]).buffer)

    await expect(
      readArtifactPayload(payloadArgs({
        artifact: {
          ...SCALAR_ARTIFACT,
          byte_length: 6,
        },
      }))
    ).rejects.toThrow('Unexpected scalar payload size')
  })

  it('fails when a frame ref is missing for the requested hour', async () => {
    await expect(
      readArtifactPayload(payloadArgs({ frameId: '999' }))
    ).rejects.toThrow('No scalar frame ref for dataset_id=gfs artifact=tmp_surface frame=999')
  })

  it('uses vector artifact kind in fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found')))

    await expect(
      readArtifactPayload(payloadArgs({ artifact: VECTOR_ARTIFACT }))
    ).rejects.toThrow('Failed to fetch vector payload: 404 Not Found')
  })
})
