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
} from '../forecast-catalog'
import {
  createLayerDataSource,
  createForecastDataTarget,
  createWindVectorDataSource,
  type ForecastDataTarget,
} from '../forecast-data-targets'
import type { ForecastDataOptions } from '../forecast-data'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import type { ForecastRenderHost } from '../forecast-render'
import type { StartupController } from './useStartupController'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useStartupController: vi.fn(),
  useDataTarget: vi.fn(),
  useForecastTimeContext: vi.fn(),
  useRequestRunner: vi.fn(),
  useDataPrefetch: vi.fn(),
}))

const DEFAULT_DATA_OPTIONS: ForecastDataOptions = {
  pressure: true,
  windVectors: true,
}

vi.mock('./useStartupController', () => ({
  useStartupController: () => mocks.useStartupController(),
}))

vi.mock('./useDataTarget', () => ({
  useDataTarget: () => mocks.useDataTarget(),
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

vi.mock('./useDataPrefetch', () => ({
  useDataPrefetch: (args: unknown) => mocks.useDataPrefetch(args),
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

function createDataTarget(overrides: Partial<ForecastDataTarget> = {}): ForecastDataTarget {
  const activeRun = overrides.activeRun ?? createActiveRunFixture(createManifestFixture())
  const hourToken = activeRun.latest.times[0].id
  const validTimeMs = Date.UTC(2026, 3, 13, 12)
  const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!
  const windLayer = getAvailableParticleLayers(activeRun).wind!
  return {
    ...createForecastDataTarget({
      activeRun,
      layerDataSource: createLayerDataSource(selectedLayer),
      windVectorDataSource: createWindVectorDataSource(windLayer),
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
    const target = createDataTarget()
    const syncCallbacks = createSyncCallbacks()
    const onProbeFrameChange = vi.fn()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useDataTarget.mockReturnValue(target)
    mocks.useForecastTimeContext.mockReturnValue({ syncCallbacks })

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
      dataOptions: DEFAULT_DATA_OPTIONS,
      onProbeFrameChange,
    }))

    expect(mocks.useStartupController).toHaveBeenCalledTimes(1)
    expect(mocks.useDataTarget).toHaveBeenCalledWith()
    expect(mocks.useRequestRunner).toHaveBeenCalledWith({
      renderHost,
      config,
      dataOptions: DEFAULT_DATA_OPTIONS,
      target,
      syncCallbacks,
      startup,
      onProbeFrameChange,
    })
    expect(mocks.useDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: true,
      dataOptions: DEFAULT_DATA_OPTIONS,
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
    mocks.useDataTarget.mockReturnValue(null)

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
      dataOptions: DEFAULT_DATA_OPTIONS,
    }))

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      startup,
    }))
    expect(mocks.useDataPrefetch).toHaveBeenCalledWith(expect.objectContaining({
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
    const target = createDataTarget()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useDataTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      renderHost,
      config,
      dataOptions: DEFAULT_DATA_OPTIONS,
    }))

    expect(mocks.useDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: false,
      dataOptions: DEFAULT_DATA_OPTIONS,
    })
  })

  it('passes the pressure contour option to data loading and prefetch', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()
    const target = createDataTarget()

    mocks.useStartupController.mockReturnValue(startup)
    mocks.useDataTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      renderHost,
      config,
      dataOptions: { pressure: false, windVectors: true },
    }))

    expect(mocks.useRequestRunner).toHaveBeenCalledWith(expect.objectContaining({
      dataOptions: { pressure: false, windVectors: true },
    }))
    expect(mocks.useDataPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      dataOptions: { pressure: false, windVectors: true },
    }))
  })
})
