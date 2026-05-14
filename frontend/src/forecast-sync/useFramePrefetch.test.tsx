import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createFrameManifestFixture } from '../test/fixtures'
import { getAvailableParticleLayers, getAvailableLayers } from '../forecast-catalog'
import { createForecastFrameTarget } from '../forecast-frame'
import type { ForecastSyncTarget } from './types'
import { useFramePrefetch } from './useFramePrefetch'

const mocks = vi.hoisted(() => ({
  prefetchForecastFrames: vi.fn(),
}))

vi.mock('../forecast-frame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-frame')>()
  return {
    ...actual,
    prefetchForecastFrames: (args: unknown) => mocks.prefetchForecastFrames(args),
  }
})

function createTarget(overrides: Partial<ForecastSyncTarget> = {}): ForecastSyncTarget {
  const manifest = overrides.manifest ?? createFrameManifestFixture({
    forecastHours: ['000', '003', '006', '009'],
  })
  const selectedLayer = getAvailableLayers(manifest).tmp_surface!
  const selectedParticleLayer = getAvailableParticleLayers(manifest).wind_particles!

  return {
    ...createForecastFrameTarget({
      manifest,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: selectedParticleLayer.id,
      selectedParticleLayer,
      frameWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 13, 15),
        lowerHourToken: '000',
        upperHourToken: '003',
        lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
        upperValidTimeMs: Date.UTC(2026, 3, 13, 15),
        mix: 0.5,
      },
      retryToken: 0,
    }),
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
    const target = createTarget()

    renderHook(() => useFramePrefetch({
      config,
      target,
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastFrames).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetchForecastFrames).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        field: expect.objectContaining({ key: expect.any(String) }),
      }),
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
      target: createTarget(),
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
      target: createTarget(),
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastFrames).toHaveBeenCalledTimes(1)
    })
  })
})
