import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastManifestData,
  ForecastManifestState,
} from '@/forecast/manifest'
import type { ForecastSyncStartupStatus } from '@/forecast/sync'
import {
  createForecastManifestDataFixture,
  createForecastManifestStateFixture,
} from '@/test/fixtures'
import ForecastApp from './ForecastApp'

const mocks = vi.hoisted(() => ({
  manifestState: null as ForecastManifestState | null,
  shellProps: null as {
    forecast: ForecastManifestData | null
    onSyncStartupStatusChange?: (status: ForecastSyncStartupStatus | null) => void
  } | null,
}))

vi.mock('@/forecast/manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/manifest')>()
  return {
    ...actual,
    useForecastManifest: () => mocks.manifestState,
  }
})

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
  data = createForecastManifestDataFixture({ setActiveModel: vi.fn() })
): ForecastManifestState {
  return createForecastManifestStateFixture({
    data,
    error: null,
    retry: vi.fn(),
  })
}

function createSyncStatus(overrides: Partial<ForecastSyncStartupStatus> = {}): ForecastSyncStartupStatus {
  return {
    startupPhase: 'idle',
    startupErrorMessage: null,
    retry: vi.fn(),
    ...overrides,
  }
}

function renderForecastApp() {
  return render(<ForecastApp />)
}

function publishSyncStatus(overrides: Partial<ForecastSyncStartupStatus> = {}) {
  act(() => {
    mocks.shellProps?.onSyncStartupStatusChange?.(createSyncStatus(overrides))
  })
}

function expectStatusText(title: string, detail?: string) {
  expect(screen.getByText(title)).toBeInTheDocument()
  if (detail != null) {
    expect(screen.getByText(detail)).toBeInTheDocument()
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
    const data = createForecastManifestDataFixture({ setActiveModel: vi.fn() })
    mocks.manifestState = createReadyManifestState(data)

    renderForecastApp()

    expect(mocks.shellProps?.forecast).toBe(data)
    expect(mocks.shellProps?.onSyncStartupStatusChange).toEqual(expect.any(Function))
  })

  it('mounts app status at the app level and projects manifest loading state', () => {
    renderForecastApp()

    expectStatusText('Loading Forecast', 'Fetching forecast manifest.')
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

    renderForecastApp()

    screen.getByRole('button', { name: 'Retry' }).click()

    expectStatusText('Forecast Load Failed', 'manifest failed')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('projects lifted sync startup status after the manifest is ready', () => {
    mocks.manifestState = createReadyManifestState()
    renderForecastApp()

    expect(screen.queryByText('Initializing Forecast Map')).not.toBeInTheDocument()

    publishSyncStatus({ startupPhase: 'loading' })

    expectStatusText('Initializing Forecast Map', 'Loading initial forecast data.')

    publishSyncStatus({ startupPhase: 'ready' })

    expect(screen.queryByText('Initializing Forecast Map')).not.toBeInTheDocument()
  })

  it('uses manifest status before lifted sync status while manifest is blocked', () => {
    renderForecastApp()

    publishSyncStatus({
      startupPhase: 'error',
      startupErrorMessage: 'wind failed',
    })

    expectStatusText('Loading Forecast')
    expect(screen.queryByText('Forecast Startup Failed')).not.toBeInTheDocument()
  })
})
