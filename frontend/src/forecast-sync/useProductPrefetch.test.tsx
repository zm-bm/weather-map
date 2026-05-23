import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { createForecastProductTarget } from '../forecast-products'
import type { ForecastProductTarget } from '../forecast-products'
import { useProductPrefetch } from './useProductPrefetch'

const mocks = vi.hoisted(() => ({
  prefetchForecastProducts: vi.fn(),
}))

const DEFAULT_PRODUCT_OPTIONS = {
  pressure: true,
  windVectors: true,
}

vi.mock('../forecast-products', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-products')>()
  return {
    ...actual,
    prefetchForecastProducts: (args: unknown) => mocks.prefetchForecastProducts(args),
  }
})

function createTarget(overrides: Partial<ForecastProductTarget> = {}): ForecastProductTarget {
  const activeRun = overrides.activeRun ?? createActiveRunFixture(createSingleTimeManifestFixture({
    forecastHours: ['000', '003', '006', '009'],
  }))
  const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!
  const windLayer = getAvailableParticleLayers(activeRun).wind!

  return {
    ...createForecastProductTarget({
      activeRun,
      selectedLayer,
      windVectorSource: {
        id: String(windLayer.id),
        artifactId: particleLayerSourceArtifactId(windLayer),
      },
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 13, 15),
        lowerHourToken: '000',
        upperHourToken: '003',
        lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
        upperValidTimeMs: Date.UTC(2026, 3, 13, 15),
        mix: 0.5,
      },
    }),
    ...overrides,
  }
}

describe('useProductPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetchForecastProducts.mockResolvedValue(undefined)
  })

  it('delegates current interpolation-window prefetching to forecast-products', async () => {
    const config = createConfigFixture()
    const target = createTarget()

    renderHook(() => useProductPrefetch({
      config,
      target,
      enabled: true,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastProducts).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetchForecastProducts).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({ id: 'field', key: expect.any(String) }),
        ]),
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

    renderHook(() => useProductPrefetch({
      config,
      target,
      enabled: true,
      productOptions: { pressure: false, windVectors: true },
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastProducts).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetchForecastProducts).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        products: expect.not.arrayContaining([
          expect.objectContaining({ id: 'pressure' }),
        ]),
      }),
    }))
  })

  it('aborts queued prefetch work when disabled', async () => {
    const observedSignals: AbortSignal[] = []
    const observeSignal = (args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return new Promise<void>(() => {})
    }
    mocks.prefetchForecastProducts.mockImplementation(observeSignal)

    const { rerender } = renderHook((props: { enabled: boolean }) => useProductPrefetch({
      config: createConfigFixture(),
      target: createTarget(),
      enabled: props.enabled,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(mocks.prefetchForecastProducts).toHaveBeenCalledTimes(1)
    })

    rerender({ enabled: false })

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.prefetchForecastProducts).toHaveBeenCalledTimes(1)
  })

  it('suppresses prefetch failures', async () => {
    mocks.prefetchForecastProducts.mockRejectedValue(new Error('prefetch failed'))

    renderHook(() => useProductPrefetch({
      config: createConfigFixture(),
      target: createTarget(),
      enabled: true,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    }))

    await waitFor(() => {
      expect(mocks.prefetchForecastProducts).toHaveBeenCalledTimes(1)
    })
  })
})
