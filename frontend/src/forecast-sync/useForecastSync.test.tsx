import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createManifestFixture, createMapFixture } from '../test/fixtures'
import { getAvailableParticleLayers, getAvailableLayers } from '../forecast-catalog'
import { createForecastDataTarget } from '../forecast-data'
import type { StartupState, ForecastSyncTarget } from './types'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useStartupState: vi.fn(),
  useSyncTarget: vi.fn(),
  useSyncRunner: vi.fn(),
  useForecastDataPrefetch: vi.fn(),
  useStartupAppStatus: vi.fn(),
}))

vi.mock('./useStartupState', () => ({
  useStartupState: () => mocks.useStartupState(),
}))

vi.mock('./useSyncTarget', () => ({
  useSyncTarget: (retryToken: number) => mocks.useSyncTarget(retryToken),
}))

vi.mock('./useSyncRunner', () => ({
  useSyncRunner: (args: unknown) => mocks.useSyncRunner(args),
}))

vi.mock('./useForecastDataPrefetch', () => ({
  useForecastDataPrefetch: (args: unknown) => mocks.useForecastDataPrefetch(args),
}))

vi.mock('./useStartupAppStatus', () => ({
  useStartupAppStatus: (status: unknown) => mocks.useStartupAppStatus(status),
}))

function createStartupState(overrides: Partial<StartupState> = {}): StartupState {
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

function createSyncTarget(overrides: Partial<ForecastSyncTarget> = {}): ForecastSyncTarget {
  const manifest = overrides.manifest ?? createManifestFixture()
  const hourToken = manifest.times[0].id
  const validTimeMs = Date.UTC(2026, 3, 13, 12)
  const selectedLayer = getAvailableLayers(manifest).temperature!
  const selectedParticleLayer = getAvailableParticleLayers(manifest).wind!
  return {
    ...createForecastDataTarget({
      manifest,
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
    sync: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    },
    ...overrides,
  }
}

describe('useForecastSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires startup state into target composition, runner execution, and app status', () => {
    const map = createMapFixture()
    const getMap = () => map
    const config = createConfigFixture()
    const startup = createStartupState({ retryToken: 2 })
    const target = createSyncTarget()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useSyncTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      getMap,
      mapReadyVersion: 3,
      config,
    }))

    expect(mocks.useStartupState).toHaveBeenCalledTimes(1)
    expect(mocks.useSyncTarget).toHaveBeenCalledWith(2)
    expect(mocks.useSyncRunner).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion: 3,
      config,
      target,
      startup,
    })
    expect(mocks.useForecastDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: true,
    })
    expect(mocks.useStartupAppStatus).toHaveBeenCalledWith(startup.status)
  })

  it('passes null targets through to the sync runner', () => {
    const map = createMapFixture()
    const getMap = () => map
    const config = createConfigFixture()
    const startup = createStartupState()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useSyncTarget.mockReturnValue(null)

    renderHook(() => useForecastSync({
      getMap,
      mapReadyVersion: 1,
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
    expect(mocks.useStartupAppStatus).toHaveBeenCalledWith(startup.status)
  })

  it('disables frame prefetch while startup is blocked', () => {
    const map = createMapFixture()
    const getMap = () => map
    const config = createConfigFixture()
    const startup = createStartupState({ isBlocked: true })
    const target = createSyncTarget()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useSyncTarget.mockReturnValue(target)

    renderHook(() => useForecastSync({
      getMap,
      mapReadyVersion: 1,
      config,
    }))

    expect(mocks.useForecastDataPrefetch).toHaveBeenCalledWith({
      config,
      target,
      enabled: false,
    })
  })
})
