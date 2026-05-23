import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createConfigFixture,
  createManifestFixture,
} from '../test/fixtures'
import { FORECAST_LAYERS_BY_ID, getAvailableParticleLayers } from '../forecast-catalog'
import { createForecastDataTarget } from '../forecast-data'
import type { FieldInterpolationWindowData, ForecastDataTarget } from '../forecast-data'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import type { ForecastRenderHost } from '../forecast-render'
import type { ForecastSyncStartupState } from './types'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useStartupState: vi.fn(),
  useForecastDataTarget: vi.fn(),
  useForecastTimeContext: vi.fn(),
  useSyncRunner: vi.fn(),
  useForecastDataPrefetch: vi.fn(),
}))

vi.mock('./useStartupState', () => ({
  useStartupState: () => mocks.useStartupState(),
}))

vi.mock('./useForecastDataTarget', () => ({
  useForecastDataTarget: (retryToken: number) => mocks.useForecastDataTarget(retryToken),
}))

vi.mock('../forecast-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.useForecastTimeContext(),
  }
})

vi.mock('./useSyncRunner', () => ({
  useSyncRunner: (args: unknown) => mocks.useSyncRunner(args),
}))

vi.mock('./useForecastDataPrefetch', () => ({
  useForecastDataPrefetch: (args: unknown) => mocks.useForecastDataPrefetch(args),
}))

function createStartupState(
  overrides: Partial<ForecastSyncStartupState> = {}
): ForecastSyncStartupState {
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
  const selectedParticleLayer = getAvailableParticleLayers(activeRun).wind!
  return {
    ...createForecastDataTarget({
      activeRun,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: selectedParticleLayer.id,
      selectedParticleLayer,
      interpolationWindow: {
        selectedValidTimeMs: validTimeMs,
        lowerHourToken: hourToken,
        upperHourToken: hourToken,
        lowerValidTimeMs: validTimeMs,
        upperValidTimeMs: validTimeMs,
        mix: 0,
      },
      retryToken: 0,
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
    mocks.useSyncRunner.mockReturnValue({
      appliedProbeField: null,
    })
  })

  it('wires startup state into target composition, runner execution, prefetch, and return status', () => {
    const renderHost: ForecastRenderHost = { version: 3, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState({ retryToken: 2 })
    const target = createDataTarget()
    const syncCallbacks = createSyncCallbacks()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useForecastDataTarget.mockReturnValue(target)
    mocks.useForecastTimeContext.mockReturnValue({ syncCallbacks })

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
    }))

    expect(mocks.useStartupState).toHaveBeenCalledTimes(1)
    expect(mocks.useForecastDataTarget).toHaveBeenCalledWith(2)
    expect(mocks.useSyncRunner).toHaveBeenCalledWith({
      renderHost,
      config,
      target,
      syncCallbacks,
      startup,
      pressureContoursEnabled: true,
    })
    expect(mocks.useForecastDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: true,
      pressureContoursEnabled: true,
    })
    expect(result.current).toEqual({
      startupStatus: startup.status,
      appliedProbeField: null,
    })
  })

  it('passes null targets through to the sync runner', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useForecastDataTarget.mockReturnValue(null)

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
    }))

    expect(mocks.useSyncRunner).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      startup,
    }))
    expect(mocks.useForecastDataPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      target: null,
      enabled: true,
    }))
    expect(result.current).toEqual({
      startupStatus: startup.status,
      appliedProbeField: null,
    })
  })

  it('returns the applied probe field from the sync runner', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()
    const appliedProbeField = {
      lower: { layerId: 'temperature' },
      upper: { layerId: 'temperature' },
      mix: 0,
    } as FieldInterpolationWindowData

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useForecastDataTarget.mockReturnValue(createDataTarget())
    mocks.useSyncRunner.mockReturnValue({ appliedProbeField })

    const { result } = renderHook(() => useForecastSync({
      renderHost,
      config,
    }))

    expect(result.current).toEqual({
      startupStatus: startup.status,
      appliedProbeField,
    })
  })

  it('disables frame prefetch while startup is blocked', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState({ isBlocked: true })
    const target = createDataTarget()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useForecastDataTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      renderHost,
      config,
    }))

    expect(mocks.useForecastDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: false,
      pressureContoursEnabled: true,
    })
  })

  it('passes the pressure contour option to data loading and prefetch', () => {
    const renderHost: ForecastRenderHost = { version: 1, apply: vi.fn() }
    const config = createConfigFixture()
    const startup = createStartupState()
    const target = createDataTarget()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useForecastDataTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      renderHost,
      config,
      pressureContoursEnabled: false,
    }))

    expect(mocks.useSyncRunner).toHaveBeenCalledWith(expect.objectContaining({
      pressureContoursEnabled: false,
    }))
    expect(mocks.useForecastDataPrefetch).toHaveBeenCalledWith(expect.objectContaining({
      pressureContoursEnabled: false,
    }))
  })
})
