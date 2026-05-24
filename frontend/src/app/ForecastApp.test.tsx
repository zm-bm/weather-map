import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastManifestData,
  ForecastManifestState,
} from '@/forecast/manifest'
import type { ForecastSyncStartupStatus } from '@/forecast/sync'
import ForecastApp from './ForecastApp'

const mocks = vi.hoisted(() => ({
  manifestState: null as ForecastManifestState | null,
  shellProps: null as {
    forecast: ForecastManifestData | null
    onSyncStartupStatusChange?: (status: ForecastSyncStartupStatus | null) => void
  } | null,
}))

vi.mock('@/forecast/manifest', () => ({
  useForecastManifest: () => mocks.manifestState,
}))

vi.mock('@/forecast/ui/ForecastShell', () => ({
  default: (props: {
    forecast: ForecastManifestData | null
    onSyncStartupStatusChange?: (status: ForecastSyncStartupStatus | null) => void
  }) => {
    mocks.shellProps = props
    return <div data-testid="forecast-shell" />
  },
}))

function createReadyManifestState(
  data = { marker: 'forecast' } as unknown as ForecastManifestData
): ForecastManifestState {
  return {
    phase: 'ready',
    data,
    error: null,
    retry: vi.fn(),
  }
}

function createSyncStatus(overrides: Partial<ForecastSyncStartupStatus> = {}): ForecastSyncStartupStatus {
  return {
    startupPhase: 'idle',
    startupErrorMessage: null,
    retry: vi.fn(),
    ...overrides,
  }
}

describe('ForecastApp', () => {
  beforeEach(() => {
    mocks.manifestState = {
      phase: 'loading',
      data: null,
      error: null,
      retry: vi.fn(),
    }
    mocks.shellProps = null
  })

  it('passes forecast manifest data to the shell', () => {
    const data = { marker: 'forecast' } as unknown as ForecastManifestData
    mocks.manifestState = createReadyManifestState(data)

    render(<ForecastApp />)

    expect(mocks.shellProps?.forecast).toBe(data)
    expect(mocks.shellProps?.onSyncStartupStatusChange).toEqual(expect.any(Function))
  })

  it('mounts app status at the app level and projects manifest loading state', () => {
    render(<ForecastApp />)

    expect(screen.getByText('Loading Forecast')).toBeInTheDocument()
    expect(screen.getByText('Fetching forecast manifest.')).toBeInTheDocument()
    expect(screen.getByText('Loading Forecast').closest('.forecast-screen__status-overlay'))
      .not.toBeNull()
  })

  it('projects retryable manifest errors', () => {
    const retry = vi.fn()
    mocks.manifestState = {
      phase: 'error',
      data: null,
      error: new Error('manifest failed'),
      retry,
    }

    render(<ForecastApp />)

    screen.getByRole('button', { name: 'Retry' }).click()

    expect(screen.getByText('Forecast Load Failed')).toBeInTheDocument()
    expect(screen.getByText('manifest failed')).toBeInTheDocument()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('projects lifted sync startup status after the manifest is ready', () => {
    mocks.manifestState = createReadyManifestState()
    render(<ForecastApp />)

    expect(screen.queryByText('Initializing Forecast Map')).not.toBeInTheDocument()

    act(() => {
      mocks.shellProps?.onSyncStartupStatusChange?.(createSyncStatus({
        startupPhase: 'loading',
      }))
    })

    expect(screen.getByText('Initializing Forecast Map')).toBeInTheDocument()
    expect(screen.getByText('Loading initial forecast data.')).toBeInTheDocument()

    act(() => {
      mocks.shellProps?.onSyncStartupStatusChange?.(createSyncStatus({
        startupPhase: 'ready',
      }))
    })

    expect(screen.queryByText('Initializing Forecast Map')).not.toBeInTheDocument()
  })

  it('uses manifest status before lifted sync status while manifest is blocked', () => {
    render(<ForecastApp />)

    act(() => {
      mocks.shellProps?.onSyncStartupStatusChange?.(createSyncStatus({
        startupPhase: 'error',
        startupErrorMessage: 'wind failed',
      }))
    })

    expect(screen.getByText('Loading Forecast')).toBeInTheDocument()
    expect(screen.queryByText('Forecast Startup Failed')).not.toBeInTheDocument()
  })
})
