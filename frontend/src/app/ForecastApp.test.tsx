import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastManifestData,
  ForecastManifestState,
} from '@/forecast/manifest'
import type { ForecastSyncInitialStatus } from '@/forecast/sync'
import {
  createForecastManifestDataFixture,
  createForecastManifestStateFixture,
} from '@/test/fixtures'
import ForecastApp from './ForecastApp'

const mocks = vi.hoisted(() => ({
  manifestState: null as ForecastManifestState | null,
  shellProps: null as {
    forecast: ForecastManifestData | null
    onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
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
    onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
  }) => {
    mocks.shellProps = props
    return <div data-testid="forecast-shell" />
  },
}))

function createReadyManifestState(
  data = createForecastManifestDataFixture()
): ForecastManifestState {
  return createForecastManifestStateFixture({
    data,
    error: null,
    retry: vi.fn(),
  })
}

function createInitialSyncStatus(overrides: Partial<ForecastSyncInitialStatus> = {}): ForecastSyncInitialStatus {
  return {
    phase: 'idle',
    errorMessage: null,
    retry: vi.fn(),
    ...overrides,
  }
}

function renderForecastApp() {
  return render(<ForecastApp />)
}

function publishInitialSyncStatus(overrides: Partial<ForecastSyncInitialStatus> = {}) {
  act(() => {
    mocks.shellProps?.onInitialSyncStatusChange?.(createInitialSyncStatus(overrides))
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
    const data = createForecastManifestDataFixture()
    mocks.manifestState = createReadyManifestState(data)

    renderForecastApp()

    expect(mocks.shellProps?.forecast).toBe(data)
    expect(mocks.shellProps?.onInitialSyncStatusChange).toEqual(expect.any(Function))
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

  it('projects lifted initial sync status after the manifest is ready', () => {
    mocks.manifestState = createReadyManifestState()
    renderForecastApp()

    expect(screen.queryByText('Initializing Forecast Map')).not.toBeInTheDocument()

    publishInitialSyncStatus({ phase: 'loading' })

    expectStatusText('Initializing Forecast Map', 'Loading initial forecast data.')

    publishInitialSyncStatus({ phase: 'ready' })

    expect(screen.queryByText('Initializing Forecast Map')).not.toBeInTheDocument()
  })

  it('uses manifest status before lifted sync status while manifest is blocked', () => {
    renderForecastApp()

    publishInitialSyncStatus({
      phase: 'error',
      errorMessage: 'wind failed',
    })

    expectStatusText('Loading Forecast')
    expect(screen.queryByText('Forecast Startup Failed')).not.toBeInTheDocument()
  })
})
