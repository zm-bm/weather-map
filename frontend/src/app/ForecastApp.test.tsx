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
    onFieldLoadingChange?: (isLoading: boolean) => void
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
    onFieldLoadingChange?: (isLoading: boolean) => void
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

function publishFieldLoadingChange(isLoading: boolean) {
  act(() => {
    mocks.shellProps?.onFieldLoadingChange?.(isLoading)
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

  it('passes manifest index data to the shell', () => {
    const data = createForecastManifestDataFixture()
    mocks.manifestState = createReadyManifestState(data)

    renderForecastApp()

    expect(mocks.shellProps?.forecast).toBe(data)
    expect(mocks.shellProps?.onInitialSyncStatusChange).toEqual(expect.any(Function))
    expect(mocks.shellProps?.onFieldLoadingChange).toEqual(expect.any(Function))
  })

  it('mounts app status at the app level and projects manifest loading state', () => {
    renderForecastApp()

    expectStatusText('Loading Forecast')
    expect(screen.getByRole('status', {
      name: 'Loading Forecast',
    })).toBeInTheDocument()
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

    screen.getByRole('button', { name: 'Retry Feed' }).click()

    expectStatusText('Forecast Feed Offline', 'manifest failed')
    expect(screen.getByText('Retry reconnects to the forecast catalog. If this continues, the latest manifest may be unavailable or unreachable.'))
      .toBeInTheDocument()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('projects lifted initial sync status after the manifest is ready', () => {
    mocks.manifestState = createReadyManifestState()
    renderForecastApp()

    publishInitialSyncStatus({ phase: 'loading' })

    expectStatusText('Loading Map Field')
    expect(screen.getByRole('status', {
      name: 'Loading Map Field',
    })).toBeInTheDocument()

    publishInitialSyncStatus({ phase: 'ready' })

    expect(screen.queryByText('Loading Map Field')).not.toBeInTheDocument()
  })

  it('projects map field update loading after the manifest is ready', () => {
    mocks.manifestState = createReadyManifestState()
    renderForecastApp()

    publishFieldLoadingChange(true)
    expectStatusText('Loading Map Field')

    publishFieldLoadingChange(false)
    expect(screen.queryByText('Loading Map Field')).not.toBeInTheDocument()
  })

  it('projects retryable initial sync errors after the manifest is ready', () => {
    const retry = vi.fn()
    mocks.manifestState = createReadyManifestState()
    renderForecastApp()

    publishInitialSyncStatus({
      phase: 'error',
      errorMessage: 'texture upload failed',
      retry,
    })

    screen.getByRole('button', { name: 'Retry Field' }).click()

    expectStatusText('Field Startup Failed', 'texture upload failed')
    expect(screen.getByText('Retry reloads the current field data and restarts renderer setup for this source and cycle.'))
      .toBeInTheDocument()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('keeps field errors ahead of map field update loading', () => {
    mocks.manifestState = createReadyManifestState()
    renderForecastApp()

    publishFieldLoadingChange(true)
    publishInitialSyncStatus({
      phase: 'error',
      errorMessage: 'texture upload failed',
    })

    expectStatusText('Field Startup Failed', 'texture upload failed')
  })

  it('uses manifest status before lifted sync status while manifest is blocked', () => {
    renderForecastApp()

    publishInitialSyncStatus({
      phase: 'error',
      errorMessage: 'wind failed',
    })

    expectStatusText('Loading Forecast')
  })
})
