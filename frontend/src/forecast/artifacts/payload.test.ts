import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FramePayloadRef } from '@/forecast/manifest'
import { resolveActiveRunFrameRef } from '@/forecast/manifest'
import {
  createActiveRunFixture,
  createConfigFixture,
  createSingleTimeManifestFixture,
  createSignalFixture,
} from '@/test/fixtures'
import {
  createFetchErrorResponse,
  stubFetchArrayBufferOnce,
} from '@/test/fetch'
import { __resetPayloadFrameCacheForTests } from '@/forecast/cache/payloadFrameCache'
import { readArtifactPayload } from './payload'

const BASE_MANIFEST = createSingleTimeManifestFixture({ forecastHours: ['000'] })
const BASE_ACTIVE_RUN = createActiveRunFixture(BASE_MANIFEST)
const BASE_LATEST_RUN = BASE_ACTIVE_RUN.latest
const SCALAR_ARTIFACT = BASE_LATEST_RUN.artifacts.tmp_surface
const VECTOR_ARTIFACT = BASE_LATEST_RUN.artifacts.wind10m_uv
const SCALAR_FRAME_REF = resolveActiveRunFrameRef({
  activeRun: BASE_ACTIVE_RUN,
  artifactId: 'tmp_surface',
  hourToken: '000',
  kind: 'scalar',
})
const VECTOR_FRAME_REF = resolveActiveRunFrameRef({
  activeRun: BASE_ACTIVE_RUN,
  artifactId: 'wind10m_uv',
  hourToken: '000',
  kind: 'vector',
})

function resolvedArtifact(args: {
  artifact?: typeof SCALAR_ARTIFACT | typeof VECTOR_ARTIFACT
  frameRef?: FramePayloadRef
  hourToken?: string
} = {}) {
  const artifact = args.artifact ?? SCALAR_ARTIFACT
  const hourToken = args.hourToken ?? '000'
  return {
    artifactId: String(artifact.id),
    hourToken,
    artifact,
    frameRef: args.frameRef ?? resolveActiveRunFrameRef({
      activeRun: BASE_ACTIVE_RUN,
      artifactId: String(artifact.id),
      hourToken,
      kind: artifact.kind,
    }),
  }
}

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

describe('readArtifactPayload', () => {
  it('loads a payload buffer', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    const payload = await readArtifactPayload({
      config: createConfigFixture(),
      activeRun: BASE_ACTIVE_RUN,
      resolved: resolvedArtifact(),
      signal: createSignalFixture(),
    })

    expect(payload.byteLength).toBe(8)
  })

  it('uses the in-memory cache for repeated manifest-scoped loads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Int16Array([1, 2, 3, 4]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = {
      config: createConfigFixture(),
      activeRun: BASE_ACTIVE_RUN,
      resolved: resolvedArtifact(),
      signal: createSignalFixture(),
    }

    await readArtifactPayload(args)
    await readArtifactPayload(args)

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
      activeRun: BASE_ACTIVE_RUN,
      resolved: resolvedArtifact(),
      signal: createSignalFixture(),
    }

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
      activeRun: BASE_ACTIVE_RUN,
      resolved: resolvedArtifact(),
    }

    const firstLoad = readArtifactPayload({
      ...baseArgs,
      signal: firstController.signal,
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const secondLoad = readArtifactPayload({
      ...baseArgs,
      signal: secondController.signal,
    })
    secondController.abort()
    response.resolve(payload)

    await expect(secondLoad).rejects.toMatchObject({ name: 'AbortError' })
    await expect(firstLoad).resolves.toBe(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails on fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found')))

    await expect(
      readArtifactPayload({
        config: createConfigFixture(),
        activeRun: BASE_ACTIVE_RUN,
        resolved: resolvedArtifact(),
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Failed to fetch scalar payload: 404 Not Found')
  })

  it('fails when payload byte length does not match the forecast manifest', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    await expect(
      readArtifactPayload({
        config: createConfigFixture(),
        activeRun: BASE_ACTIVE_RUN,
        resolved: resolvedArtifact({
          frameRef: {
            ...SCALAR_FRAME_REF,
            byteLength: 6,
          },
        }),
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unexpected scalar payload size')
  })

  it('fails when vector payload byte length does not match the grid dimensions', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    await expect(
      readArtifactPayload({
        config: createConfigFixture(),
        activeRun: BASE_ACTIVE_RUN,
        resolved: resolvedArtifact({
          artifact: {
            ...VECTOR_ARTIFACT,
            grid: {
              ...VECTOR_ARTIFACT.grid,
              nx: 3,
              ny: 3,
            },
          },
          frameRef: VECTOR_FRAME_REF,
        }),
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('vector payload bytes do not match grid dimensions')
  })

  it('loads payloads from frame refs without sha metadata', async () => {
    stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    const payload = await readArtifactPayload({
      config: createConfigFixture(),
      activeRun: BASE_ACTIVE_RUN,
      resolved: resolvedArtifact({ frameRef: SCALAR_FRAME_REF }),
      signal: createSignalFixture(),
    })

    expect(payload.byteLength).toBe(8)
  })
})
