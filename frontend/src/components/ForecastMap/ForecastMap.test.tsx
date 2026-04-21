import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ForecastMap from './ForecastMap'
import type { FrameSyncRequest } from '../../hooks/frameSyncTypes'
import type { StartupSyncState, StartupSyncStatus } from '../../hooks/useStartupSyncState'
import { createManifestFixture, createMapFixture } from '../../test/fixtures'

function createSyncRequest(
  overrides: Partial<FrameSyncRequest> = {}
): FrameSyncRequest {
  const manifest = overrides.manifest ?? createManifestFixture()
  return {
    manifest,
    activeScalar: manifest.scalarVariables[0],
    activeVector: manifest.vectorVariables[0],
    activeHourIndex: 0,
    hourToken: manifest.forecastHours[0],
    syncKey: `${manifest.cycle}:${manifest.scalarVariables[0]}:${manifest.vectorVariables[0]}:${manifest.forecastHours[0]}:0`,
    sync: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    },
    ...overrides,
  }
}

const mocks = vi.hoisted(() => ({
  useMapLibre: vi.fn(),
  useFrameSyncRunner: vi.fn(),
  useStartupSyncState: vi.fn(),
  setStatus: vi.fn(),
  clearStatus: vi.fn(),
  runnerArgs: null as Record<string, unknown> | null,
  startupSyncState: null as StartupSyncState | null,
  syncRequest: null as FrameSyncRequest | null,
}))

vi.mock('../../hooks/useMapLibre', () => ({
  useMapLibre: (args: unknown) => mocks.useMapLibre(args),
}))

vi.mock('../../hooks/useMapHover', () => ({
  useMapHover: vi.fn(),
}))

vi.mock('../../hooks/useMapClick', () => ({
  useMapClick: vi.fn(),
}))

vi.mock('../../state/appStatus', () => ({
  useAppStatus: () => ({
    entries: [],
    setStatus: mocks.setStatus,
    clearStatus: mocks.clearStatus,
  }),
}))

vi.mock('../../state/useFrameSyncRequest', () => ({
  useFrameSyncRequest: () => mocks.syncRequest,
}))

vi.mock('../../hooks/useFrameSyncRunner', () => ({
  useFrameSyncRunner: (args: Record<string, unknown>) => {
    mocks.runnerArgs = args
    mocks.useFrameSyncRunner(args)
  },
}))

vi.mock('../../hooks/useStartupSyncState', () => ({
  useStartupSyncState: () => {
    mocks.useStartupSyncState()
    if (mocks.startupSyncState == null) {
      throw new Error('startupSyncState test fixture not initialized')
    }
    return mocks.startupSyncState
  },
}))

describe('ForecastMap startup ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runnerArgs = null
    const startupStatus: StartupSyncStatus = {
      startupPhase: 'idle',
      startupErrorMessage: null,
      retry: vi.fn(),
    }
    mocks.startupSyncState = {
      status: startupStatus,
      retryToken: 0,
      isStartupBlocked: false,
      handleDisabled: vi.fn(),
      handlePending: vi.fn(),
      handleApplied: vi.fn(),
      handleError: vi.fn(),
    }
    mocks.syncRequest = null

    const map = createMapFixture()
    mocks.useMapLibre.mockReturnValue({
      mapRef: { current: map },
      getMap: () => map,
      mapReadyVersion: 1,
    })
  })

  it('always initializes map runtime even without sync request', async () => {
    render(<ForecastMap />)

    expect(mocks.useMapLibre).toHaveBeenCalledTimes(1)
    expect(mocks.useStartupSyncState).toHaveBeenCalledTimes(1)
    expect(mocks.useFrameSyncRunner).toHaveBeenCalledTimes(1)
    expect(mocks.runnerArgs?.syncRequest).toBeNull()

    await waitFor(() => {
      expect(mocks.clearStatus).toHaveBeenCalledWith('startupSync')
    })
  })

  it('publishes startup loading status and passes selector sync request', async () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      generatedAt: '2026-04-09T00:00:00Z',
    })
    const syncRequest = createSyncRequest({
      manifest,
      activeHourIndex: 1,
      hourToken: manifest.forecastHours[1],
      syncKey: `${manifest.cycle}:${manifest.scalarVariables[0]}:${manifest.vectorVariables[0]}:${manifest.forecastHours[1]}:2`,
    })
    mocks.syncRequest = syncRequest
    const retry = vi.fn()
    mocks.startupSyncState = {
      ...(mocks.startupSyncState as StartupSyncState),
      status: {
        startupPhase: 'loading',
        startupErrorMessage: null,
        retry,
      },
      retryToken: 2,
      isStartupBlocked: false,
    }

    render(<ForecastMap />)

    expect(mocks.runnerArgs?.syncRequest).toBe(syncRequest)
    expect((mocks.runnerArgs?.syncState as { isStartupBlocked: boolean })?.isStartupBlocked).toBe(false)

    await waitFor(() => {
      expect(mocks.setStatus).toHaveBeenCalledWith(
        'startupSync',
        expect.objectContaining({
          mode: 'blocking',
          level: 'loading',
          title: 'Initializing Forecast Map',
        })
      )
    })
  })

  it('publishes startup error status and wires retry action', async () => {
    const retry = vi.fn()
    mocks.syncRequest = createSyncRequest()
    mocks.startupSyncState = {
      ...(mocks.startupSyncState as StartupSyncState),
      status: {
        startupPhase: 'error',
        startupErrorMessage: 'wind failed',
        retry,
      },
      isStartupBlocked: true,
    }

    render(<ForecastMap />)

    await waitFor(() => {
      expect(mocks.setStatus).toHaveBeenCalledWith(
        'startupSync',
        expect.objectContaining({
          mode: 'blocking',
          level: 'error',
          title: 'Forecast Startup Failed',
          detail: 'wind failed',
          actionLabel: 'Retry',
          onAction: retry,
        })
      )
    })
  })

  it('forwards sync callbacks from selector request to sync hook', () => {
    const sync = {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    }
    mocks.syncRequest = createSyncRequest({ sync })

    render(<ForecastMap />)

    expect((mocks.runnerArgs?.syncRequest as { sync: unknown })?.sync).toBe(sync)
    expect((mocks.runnerArgs?.syncState as { handleApplied: unknown })?.handleApplied)
      .toBe(mocks.startupSyncState?.handleApplied)
    expect((mocks.runnerArgs?.syncState as { handleError: unknown })?.handleError)
      .toBe(mocks.startupSyncState?.handleError)
  })
})
