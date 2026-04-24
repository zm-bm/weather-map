import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createManifestFixture, createMapFixture } from '../test/fixtures'
import type { StartupState, SyncRequest } from './types'
import { useForecastSync } from './useForecastSync'

const mocks = vi.hoisted(() => ({
  useStartupState: vi.fn(),
  useSyncRequest: vi.fn(),
  useSyncRunner: vi.fn(),
  useStartupAppStatus: vi.fn(),
}))

vi.mock('./useStartupState', () => ({
  useStartupState: () => mocks.useStartupState(),
}))

vi.mock('./useSyncRequest', () => ({
  useSyncRequest: (retryToken: number) => mocks.useSyncRequest(retryToken),
}))

vi.mock('./useSyncRunner', () => ({
  useSyncRunner: (args: unknown) => mocks.useSyncRunner(args),
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

function createSyncRequest(overrides: Partial<SyncRequest> = {}): SyncRequest {
  const manifest = overrides.manifest ?? createManifestFixture()
  return {
    manifest,
    activeScalar: manifest.scalarVariables[0],
    activeVector: manifest.vectorVariables[0],
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerHourToken: manifest.forecastHours[0],
    upperHourToken: manifest.forecastHours[0],
    mix: 0,
    requestKey: `${manifest.cycle}:${manifest.scalarVariables[0]}:${manifest.vectorVariables[0]}:${manifest.forecastHours[0]}:${manifest.forecastHours[0]}:0:0`,
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

  it('wires startup state into request composition, runner execution, and app status', () => {
    const map = createMapFixture()
    const getMap = () => map
    const config = createConfigFixture()
    const startup = createStartupState({ retryToken: 2 })
    const request = createSyncRequest()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useSyncRequest.mockReturnValue(request)

    renderHook(() => useForecastSync({
      getMap,
      mapReadyVersion: 3,
      config,
    }))

    expect(mocks.useStartupState).toHaveBeenCalledTimes(1)
    expect(mocks.useSyncRequest).toHaveBeenCalledWith(2)
    expect(mocks.useSyncRunner).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion: 3,
      config,
      request,
      startup,
    })
    expect(mocks.useStartupAppStatus).toHaveBeenCalledWith(startup.status)
  })

  it('passes null requests through to the sync runner', () => {
    const map = createMapFixture()
    const getMap = () => map
    const config = createConfigFixture()
    const startup = createStartupState()

    mocks.useStartupState.mockReturnValue(startup)
    mocks.useSyncRequest.mockReturnValue(null)

    renderHook(() => useForecastSync({
      getMap,
      mapReadyVersion: 1,
      config,
    }))

    expect(mocks.useSyncRunner).toHaveBeenCalledWith(expect.objectContaining({
      request: null,
      startup,
    }))
    expect(mocks.useStartupAppStatus).toHaveBeenCalledWith(startup.status)
  })
})
