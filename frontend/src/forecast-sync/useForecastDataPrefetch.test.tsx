import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import { FORECAST_LAYERS_BY_ID, getAvailableParticleLayers } from '../forecast-catalog'
import { createForecastDataTarget } from '../forecast-data'
import type { ForecastSyncTarget } from './types'
import { useForecastDataPrefetch } from './useForecastDataPrefetch'

const mocks = vi.hoisted(() => ({
  prefetchForecastData: vi.fn(),
}))

vi.mock('../forecast-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-data')>()
  return {
    ...actual,
    prefetchForecastData: (args: unknown) => mocks.prefetchForecastData(args),
  }
})

function createTarget(overrides: Partial<ForecastSyncTarget> = {}): ForecastSyncTarget {
  const activeRun = overrides.activeRun ?? createActiveRunFixture(createSingleTimeManifestFixture({
    forecastHours: ['000', '003', '006', '009'],
  }))
  const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!
  const selectedParticleLayer = getAvailableParticleLayers(activeRun).wind!

  return {
    ...createForecastDataTarget({
      activeRun,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: selectedParticleLayer.id,
      selectedParticleLayer,
      interpolationWindow: {
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

describe('useForecastDataPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetchForecastData.mockResolvedValue(undefined)
  })

  it('delegates current interpolation-window prefetching to forecast-data', async () => {
    const config = createConfigFixture()
    const target = createTarget()

    renderHook(() => useForecastDataPrefetch({
      config,
      target,
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetchForecastData).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        field: expect.objectContaining({ key: expect.any(String) }),
      }),
      aheadHourCount: 2,
      concurrency: 2,
      signal: expect.any(AbortSignal),
    }))
  })

  it('omits pressure contour prefetch when contours are disabled', async () => {
    const config = createConfigFixture()
    const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
      scalarArtifactIds: ['tmp_surface', 'prmsl_msl'],
      forecastHours: ['000', '003'],
    }))
    const target = createTarget({ activeRun })

    renderHook(() => useForecastDataPrefetch({
      config,
      target,
      enabled: true,
      pressureContoursEnabled: false,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastData).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetchForecastData).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        pressureContours: null,
      }),
    }))
  })

  it('aborts queued prefetch work when disabled', async () => {
    const observedSignals: AbortSignal[] = []
    const observeSignal = (args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return new Promise<void>(() => {})
    }
    mocks.prefetchForecastData.mockImplementation(observeSignal)

    const { rerender } = renderHook((props: { enabled: boolean }) => useForecastDataPrefetch({
      config: createConfigFixture(),
      target: createTarget(),
      enabled: props.enabled,
    }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(mocks.prefetchForecastData).toHaveBeenCalledTimes(1)
    })

    rerender({ enabled: false })

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.prefetchForecastData).toHaveBeenCalledTimes(1)
  })

  it('suppresses prefetch failures', async () => {
    mocks.prefetchForecastData.mockRejectedValue(new Error('prefetch failed'))

    renderHook(() => useForecastDataPrefetch({
      config: createConfigFixture(),
      target: createTarget(),
      enabled: true,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastData).toHaveBeenCalledTimes(1)
    })
  })
})
