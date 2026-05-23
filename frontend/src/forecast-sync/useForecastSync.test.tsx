import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createConfigFixture,
  createManifestFixture,
} from '../test/fixtures'
import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { createForecastProductTarget } from '../forecast-products'
import type { ForecastProductOptions, ForecastProductTarget } from '../forecast-products'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import type { ForecastRenderHost } from '../forecast-render'
import type { StartupController } from './useStartupController'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useStartupController: vi.fn(),
  useProductTarget: vi.fn(),
  useForecastTimeContext: vi.fn(),
  useRequestRunner: vi.fn(),
  useProductPrefetch: vi.fn(),
}))

const DEFAULT_PRODUCT_OPTIONS: ForecastProductOptions = {
  pressure: true,
  windVectors: true,
}

vi.mock('./useStartupController', () => ({
  useStartupController: () => mocks.useStartupController(),
}))

vi.mock('./useProductTarget', () => ({
  useProductTarget: () => mocks.useProductTarget(),
}))

vi.mock('../forecast-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.useForecastTimeContext(),
  }
})

vi.mock('./useRequestRunner', () => ({
  useRequestRunner: (args: unknown) => mocks.useRequestRunner(args),
}))

vi.mock('./useProductPrefetch', () => ({
  useProductPrefetch: (args: unknown) => mocks.useProductPrefetch(args),
}))

function createStartupState(
  overrides: Partial<StartupController> = {}
): StartupController {
  const retry = vi.fn()
  return {
    status: {
      startupPhase: 'idle',
      startupErrorMessage: null,
      retry,
    },
    retryToken: 0,
    isBlocked: false,
    handleDisabled: vi.fn(),
    handlePending: vi.fn(),
    handleApplied: vi.fn(),
    handleError: vi.fn(),
    ...overrides,
  }
}

function createSyncCallbacks(): ForecastTimeSyncCallbacks {
  return {
    onRequestStart: vi.fn(),
    onRequestApplied: vi.fn(),
    onRequestError: vi.fn(),
  }
}

function createProductTarget(overrides: Partial<ForecastProductTarget> = {}): ForecastProductTarget {
  const activeRun = overrides.activeRun ?? createActiveRunFixture(createManifestFixture())
  const hourToken = activeRun.latest.times[0].id
  const validTimeMs = Date.UTC(2026, 3, 13, 12)
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
        selectedValidTimeMs: validTimeMs,
        lowerHourToken: hourToken,
        upperHourToken: hourToken,
        lowerValidTimeMs: validTimeMs,
        upperValidTimeMs: validTimeMs,
        mix: 0,
      },
    }),
    ...overrides,
  }
}

describe('useForecastSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useForecastTimeContext.mockReturnValue({
      syncCallbacks: createSyncCallbacks(),
    })
    mocks.useRequestRunner.mockReturnValue(undefined)
  })

  it('wires startup state into target composition, runner execution, prefetch, and return status', () => {
    const renderHost: ForecastRenderHost = { version: 3, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState({ retryToken: 2 })
    const target = createProductTarget()
    const syncCallbacks = createSyncCallbacks()
    const onProbeFrameChange = vi.fn()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useProductTarget.mockReturnValue(target)
    mocks.useForecastTimeContext.mockReturnValue({ syncCallbacks })

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
      onProbeFrameChange,
    }))

    expect(mocks.useStartupController).toHaveBeenCalledTimes(1)
    expect(mocks.useProductTarget).toHaveBeenCalledWith()
    expect(mocks.useRequestRunner).toHaveBeenCalledWith({
      renderHost,
      config,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
      target,
      syncCallbacks,
      startup,
      onProbeFrameChange,
    })
    expect(mocks.useProductPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: true,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    })
    expect(result.current).toEqual({
      startupStatus: startup.status,
    })
  })

  it('passes null targets through to the sync runner', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useProductTarget.mockReturnValue(null)

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    }))

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      startup,
    }))
    expect(mocks.useProductPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      enabled: true,
    }))
    expect(result.current).toEqual({
      startupStatus: startup.status,
    })
  })

  it('disables frame prefetch while startup is blocked', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState({ isBlocked: true })
    const target = createProductTarget()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useProductTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      renderHost,
      config,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    }))

    expect(mocks.useProductPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: false,
      productOptions: DEFAULT_PRODUCT_OPTIONS,
    })
  })

  it('passes the pressure contour option to product loading and prefetch', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()
    const target = createProductTarget()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useProductTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      renderHost,
      config,
      productOptions: { pressure: false, windVectors: true },
    }))

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      productOptions: { pressure: false, windVectors: true },
    }))
    expect(mocks.useProductPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      productOptions: { pressure: false, windVectors: true },
    }))
  })
})
