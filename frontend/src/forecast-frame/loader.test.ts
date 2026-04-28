import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createFrameManifestFixture, createSignalFixture } from '../test/fixtures'
import {
  createFetchErrorResponse,
  stubFetchArrayBufferOnce,
} from '../test/fetch'
import { __resetPayloadFrameCacheForTests } from '../forecast-cache/payloadFrameCache'
import { loadFramePayload, normalizeFrameHourToken } from './loader'

const BASE_MANIFEST = createFrameManifestFixture({ forecastHours: ['000'] })
const SCALAR_FRAME_REF = BASE_MANIFEST.frames['000']!.tmp_surface!
const VECTOR_FRAME_REF = BASE_MANIFEST.frames['000']!.wind10m_uv!
const GRID = BASE_MANIFEST.grids.g0!

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.unstubAllGlobals()
  return __resetPayloadFrameCacheForTests()
})

describe('normalizeFrameHourToken', () => {
  it('pads and trims hour tokens', () => {
    expect(normalizeFrameHourToken('3')).toBe('003')
    expect(normalizeFrameHourToken(' 12 ')).toBe('012')
  })
})

describe('loadFramePayload', () => {
  it('loads a payload and returns the normalized hour token', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    const loaded = await loadFramePayload({
      config: createConfigFixture(),
      manifest: BASE_MANIFEST,
      frameRef: SCALAR_FRAME_REF,
      grid: GRID,
      hourToken: '0',
      variableId: 'tmp_surface',
      frameKind: 'scalar',
      signal: createSignalFixture(),
      verifyPayloadSha256: false,
    })

    expect(loaded.hourToken).toBe('000')
    expect(loaded.payload.byteLength).toBe(8)
  })

  it('uses the in-memory cache for repeated manifest-scoped loads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Int16Array([1, 2, 3, 4]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = {
      config: createConfigFixture(),
      manifest: BASE_MANIFEST,
      frameRef: SCALAR_FRAME_REF,
      grid: GRID,
      hourToken: '000',
      variableId: 'tmp_surface',
      frameKind: 'scalar' as const,
      signal: createSignalFixture(),
      verifyPayloadSha256: false,
    }

    await loadFramePayload(args)
    await loadFramePayload(args)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes parallel loads for the same frame payload', async () => {
    const payload = new Int16Array([1, 2, 3, 4]).buffer
    const response = deferred<ArrayBuffer>()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => response.promise,
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = {
      config: createConfigFixture(),
      manifest: BASE_MANIFEST,
      frameRef: SCALAR_FRAME_REF,
      grid: GRID,
      hourToken: '000',
      variableId: 'tmp_surface',
      frameKind: 'scalar' as const,
      signal: createSignalFixture(),
      verifyPayloadSha256: false,
    }

    const firstLoad = loadFramePayload(args)
    const secondLoad = loadFramePayload(args)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    response.resolve(payload)

    await expect(firstLoad).resolves.toMatchObject({ hourToken: '000' })
    await expect(secondLoad).resolves.toMatchObject({ hourToken: '000' })
  })

  it('lets an aborted joining caller reject while the shared payload fetch completes', async () => {
    const payload = new Int16Array([1, 2, 3, 4]).buffer
    const response = deferred<ArrayBuffer>()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => response.promise,
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstController = new AbortController()
    const secondController = new AbortController()
    const baseArgs = {
      config: createConfigFixture(),
      manifest: BASE_MANIFEST,
      frameRef: SCALAR_FRAME_REF,
      grid: GRID,
      hourToken: '000',
      variableId: 'tmp_surface',
      frameKind: 'scalar' as const,
      verifyPayloadSha256: false,
    }

    const firstLoad = loadFramePayload({
      ...baseArgs,
      signal: firstController.signal,
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const secondLoad = loadFramePayload({
      ...baseArgs,
      signal: secondController.signal,
    })
    secondController.abort()
    response.resolve(payload)

    await expect(secondLoad).rejects.toMatchObject({ name: 'AbortError' })
    await expect(firstLoad).resolves.toMatchObject({ hourToken: '000' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails on fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found')))

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        frameRef: SCALAR_FRAME_REF,
        grid: GRID,
        hourToken: '000',
        variableId: 'tmp_surface',
        frameKind: 'scalar',
        signal: createSignalFixture(),
        verifyPayloadSha256: false,
      })
    ).rejects.toThrow('Failed to fetch scalar payload: 404 Not Found')
  })

  it('fails when payload byte length does not match the frame manifest', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        frameRef: {
          ...SCALAR_FRAME_REF,
          byte_length: 6,
        },
        grid: GRID,
        hourToken: '000',
        variableId: 'tmp_surface',
        frameKind: 'scalar',
        signal: createSignalFixture(),
        verifyPayloadSha256: false,
      })
    ).rejects.toThrow('Unexpected scalar payload size')
  })

  it('fails when vector payload byte length does not match the grid dimensions', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        frameRef: VECTOR_FRAME_REF,
        grid: {
          ...GRID,
          nx: 3,
          ny: 3,
        },
        hourToken: '000',
        variableId: 'wind10m_uv',
        frameKind: 'vector',
        signal: createSignalFixture(),
        verifyPayloadSha256: false,
      })
    ).rejects.toThrow('vector payload bytes do not match grid dimensions')
  })

  it('fails scalar and vector sha verification when enabled', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        frameRef: {
          ...SCALAR_FRAME_REF,
          sha256: 'deadbeef',
        },
        grid: GRID,
        hourToken: '000',
        variableId: 'tmp_surface',
        frameKind: 'scalar',
        signal: createSignalFixture(),
        verifyPayloadSha256: true,
      })
    ).rejects.toThrow('scalar SHA-256 mismatch')

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        frameRef: {
          ...VECTOR_FRAME_REF,
          sha256: 'cafebabe',
        },
        grid: GRID,
        hourToken: '000',
        variableId: 'wind10m_uv',
        frameKind: 'vector',
        signal: createSignalFixture(),
        verifyPayloadSha256: true,
      })
    ).rejects.toThrow('vector SHA-256 mismatch')
  })
})
