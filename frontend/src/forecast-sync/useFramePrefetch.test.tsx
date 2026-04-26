import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createFrameManifestFixture } from '../test/fixtures'
import type { SyncRequest } from './types'
import { useFramePrefetch } from './useFramePrefetch'

const mocks = vi.hoisted(() => ({
  prefetchFramePayloads: vi.fn(),
}))

vi.mock('../forecast-frame/prefetch', () => ({
  prefetchFramePayloads: (args: unknown) => mocks.prefetchFramePayloads(args),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createRequest(overrides: Partial<SyncRequest> = {}): SyncRequest {
  const manifest = overrides.manifest ?? createFrameManifestFixture({
    forecastHours: ['000', '003', '006', '009'],
  })

  return {
    manifest,
    activeScalar: manifest.scalarVariables[0],
    activeVector: manifest.vectorVariables[0],
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 15),
    lowerHourToken: '000',
    upperHourToken: '003',
    mix: 0.5,
    requestKey: 'request-key',
    sync: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    },
    ...overrides,
  }
}

describe('useFramePrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetchFramePayloads.mockResolvedValue(undefined)
  })

  it('prefetches the current window plus the next two forecast hours in hour-major order', async () => {
    const config = createConfigFixture()
    const request = createRequest()

    renderHook(() => useFramePrefetch({
      config,
      request,
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchFramePayloads).toHaveBeenCalledTimes(8)
    })

    expect(mocks.prefetchFramePayloads.mock.calls.map(([args]) => ({
      frameKind: args.frameKind,
      variableId: args.variableId,
      hourTokens: args.hourTokens,
    }))).toEqual([
      { frameKind: 'scalar', variableId: 'tmp_surface', hourTokens: ['000'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['000'] },
      { frameKind: 'scalar', variableId: 'tmp_surface', hourTokens: ['003'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['003'] },
      { frameKind: 'scalar', variableId: 'tmp_surface', hourTokens: ['006'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['006'] },
      { frameKind: 'scalar', variableId: 'tmp_surface', hourTokens: ['009'] },
      { frameKind: 'vector', variableId: 'wind10m_uv', hourTokens: ['009'] },
    ])
  })

  it('limits prefetch concurrency to two payload tasks', async () => {
    const requests: Array<ReturnType<typeof deferred<void>>> = []
    mocks.prefetchFramePayloads.mockImplementation(() => {
      const request = deferred<void>()
      requests.push(request)
      return request.promise
    })

    renderHook(() => useFramePrefetch({
      config: createConfigFixture(),
      request: createRequest(),
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchFramePayloads).toHaveBeenCalledTimes(2)
    })

    requests[0]!.resolve()

    await waitFor(() => {
      expect(mocks.prefetchFramePayloads).toHaveBeenCalledTimes(3)
    })

    for (const request of requests) {
      request.resolve()
    }
  })

  it('aborts queued prefetch work when disabled', async () => {
    const observedSignals: AbortSignal[] = []
    mocks.prefetchFramePayloads.mockImplementation((args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return new Promise<void>(() => {})
    })

    const { rerender } = renderHook((props: { enabled: boolean }) => useFramePrefetch({
      config: createConfigFixture(),
      request: createRequest(),
      enabled: props.enabled,
    }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(mocks.prefetchFramePayloads).toHaveBeenCalledTimes(2)
    })

    rerender({ enabled: false })

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.prefetchFramePayloads).toHaveBeenCalledTimes(2)
  })

  it('suppresses prefetch failures', async () => {
    mocks.prefetchFramePayloads.mockRejectedValue(new Error('prefetch failed'))

    renderHook(() => useFramePrefetch({
      config: createConfigFixture(),
      request: createRequest(),
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchFramePayloads).toHaveBeenCalledTimes(8)
    })
  })
})
