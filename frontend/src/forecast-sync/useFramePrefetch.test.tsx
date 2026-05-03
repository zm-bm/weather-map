import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createFrameManifestFixture } from '../test/fixtures'
import type { SyncRequest } from './types'
import { useFramePrefetch } from './useFramePrefetch'

const mocks = vi.hoisted(() => ({
  prefetchForecastFrames: vi.fn(),
}))

vi.mock('../forecast-frame', () => ({
  prefetchForecastFrames: (args: unknown) => mocks.prefetchForecastFrames(args),
}))

function createRequest(overrides: Partial<SyncRequest> = {}): SyncRequest {
  const manifest = overrides.manifest ?? createFrameManifestFixture({
    forecastHours: ['000', '003', '006', '009'],
  })

  return {
    manifest,
    activeScalar: manifest.scalarProducts[0]!,
    activeVector: manifest.vectorProducts[0]!,
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
    mocks.prefetchForecastFrames.mockResolvedValue(undefined)
  })

  it('delegates current frame-window prefetching to forecast-frame', async () => {
    const config = createConfigFixture()
    const request = createRequest()

    renderHook(() => useFramePrefetch({
      config,
      request,
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastFrames).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetchForecastFrames).toHaveBeenCalledWith(expect.objectContaining({
      config,
      manifest: request.manifest,
      activeScalar: 'tmp_surface',
      activeVector: 'wind10m_uv',
      lowerHourToken: '000',
      upperHourToken: '003',
      aheadHourCount: 2,
      concurrency: 2,
      signal: expect.any(AbortSignal),
    }))
  })

  it('aborts queued prefetch work when disabled', async () => {
    const observedSignals: AbortSignal[] = []
    const observeSignal = (args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return new Promise<void>(() => {})
    }
    mocks.prefetchForecastFrames.mockImplementation(observeSignal)

    const { rerender } = renderHook((props: { enabled: boolean }) => useFramePrefetch({
      config: createConfigFixture(),
      request: createRequest(),
      enabled: props.enabled,
    }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(mocks.prefetchForecastFrames).toHaveBeenCalledTimes(1)
    })

    rerender({ enabled: false })

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.prefetchForecastFrames).toHaveBeenCalledTimes(1)
  })

  it('suppresses prefetch failures', async () => {
    mocks.prefetchForecastFrames.mockRejectedValue(new Error('prefetch failed'))

    renderHook(() => useFramePrefetch({
      config: createConfigFixture(),
      request: createRequest(),
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastFrames).toHaveBeenCalledTimes(1)
    })
  })
})
