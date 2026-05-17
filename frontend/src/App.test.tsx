import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastModelId, ForecastModelOption } from './forecast-availability'
import type { CycleManifest } from './manifest'
import { createFrameManifestFixture, createScalarArtifactFixture } from './test/fixtures'
import App from './App'

const mocks = vi.hoisted(() => ({
  useManifest: vi.fn(),
  useAvailabilityIndex: vi.fn(),
  workspaceProps: null as Record<string, unknown> | null,
}))

vi.mock('./manifest/useManifest', () => ({
  useManifest: mocks.useManifest,
}))

vi.mock('./forecast-availability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./forecast-availability')>()
  return {
    ...actual,
    useAvailabilityIndex: mocks.useAvailabilityIndex,
  }
})

vi.mock('./components/ForecastShell/ForecastShell', () => ({
  default: ({
    manifest,
    availabilityIndex,
    activeModelId,
    modelOptions,
    onActiveModelChange,
  }: {
    manifest: CycleManifest | null
    availabilityIndex: unknown
    activeModelId: ForecastModelId | null
    modelOptions: readonly ForecastModelOption[]
    onActiveModelChange: (modelId: ForecastModelId) => void
  }) => {
    mocks.workspaceProps = { manifest, availabilityIndex, activeModelId, modelOptions }
    return (
      <div data-testid="forecast-screen">
        {manifest?.run.cycle ?? 'no-manifest'}
        <button type="button" onClick={() => onActiveModelChange('icon')}>
          select-icon
        </button>
      </div>
    )
  },
}))

function createAvailabilityIndex() {
  return {
    schema: 'weather-map-model-layer-availability-index',
    schemaVersion: 1,
    generatedAt: '2026-05-16T00:00:00Z',
    catalogVersion: 'forecast-catalog-v1',
    models: {
      gfs: {
        label: 'GFS',
        latestCycle: '2026040900',
        latestManifestPath: 'manifests/gfs/latest.json',
      },
      icon: {
        label: 'ICON',
        latestCycle: '2026040900',
        latestManifestPath: 'manifests/icon/latest.json',
      },
    },
    layers: {},
  } as const
}

describe('App composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspaceProps = null
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex: createAvailabilityIndex(),
      loading: false,
      error: null,
      retry: vi.fn(),
    })
  })

  it('loads availability before requesting a manifest', () => {
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    })
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: false,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByTestId('forecast-screen')).toHaveTextContent('no-manifest')
    expect(screen.getByText('Loading Forecast')).toBeInTheDocument()
    expect(screen.getByText('Fetching forecast layer availability.')).toBeInTheDocument()
    expect(mocks.useManifest).toHaveBeenCalledWith(null, {
      enabled: false,
    })
    expect(mocks.workspaceProps).toEqual({
      manifest: null,
      availabilityIndex: null,
      activeModelId: null,
      modelOptions: [],
    })
  })

  it('shows global availability load error and invokes retry', () => {
    const retry = vi.fn()
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex: null,
      loading: false,
      error: new Error('availability fetch failed'),
      retry,
    })
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: false,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByText('Forecast Load Failed')).toBeInTheDocument()
    expect(screen.getByText('availability fetch failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('treats an empty availability model list as a startup error', () => {
    const retry = vi.fn()
    const availabilityIndex = {
      ...createAvailabilityIndex(),
      models: {},
    }
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex,
      loading: false,
      error: null,
      retry,
    })
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: false,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByText('Forecast Load Failed')).toBeInTheDocument()
    expect(screen.getByText('Forecast availability did not list any models.')).toBeInTheDocument()
    expect(mocks.useManifest).toHaveBeenCalledWith(null, { enabled: false })
    expect(mocks.workspaceProps).toEqual({
      manifest: null,
      availabilityIndex,
      activeModelId: null,
      modelOptions: [],
    })
  })

  it('always mounts forecast shell while manifest request is in flight', () => {
    const availabilityIndex = createAvailabilityIndex()
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex,
      loading: false,
      error: null,
      retry: vi.fn(),
    })
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByTestId('forecast-screen')).toHaveTextContent('no-manifest')
    expect(screen.getByText('Loading Forecast')).toBeInTheDocument()
    expect(mocks.useManifest).toHaveBeenCalledWith('manifests/gfs/latest.json', {
      enabled: true,
    })
    expect(mocks.workspaceProps).toEqual({
      manifest: null,
      availabilityIndex,
      activeModelId: 'gfs',
      modelOptions: [
        { id: 'gfs', label: 'GFS' },
        { id: 'icon', label: 'ICON' },
      ],
    })
  })

  it('shows global manifest load error and invokes retry', () => {
    const availabilityIndex = createAvailabilityIndex()
    const retry = vi.fn()
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex,
      loading: false,
      error: null,
      retry: vi.fn(),
    })
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: false,
      error: new Error('manifest fetch failed'),
      retry,
    })

    render(<App />)

    expect(screen.getByText('Forecast Load Failed')).toBeInTheDocument()
    expect(screen.getByText('manifest fetch failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(mocks.workspaceProps).toEqual({
      manifest: null,
      availabilityIndex,
      activeModelId: 'gfs',
      modelOptions: [
        { id: 'gfs', label: 'GFS' },
        { id: 'icon', label: 'ICON' },
      ],
    })
  })

  it('reloads the manifest when the forecast model changes', () => {
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'select-icon' }))

    expect(mocks.useManifest).toHaveBeenLastCalledWith('manifests/icon/latest.json', {
      enabled: true,
    })
    expect(mocks.workspaceProps?.activeModelId).toBe('icon')
  })

  it('passes manifest and load state through once available', () => {
    const availabilityIndex = createAvailabilityIndex()
    mocks.useAvailabilityIndex.mockReturnValue({
      availabilityIndex,
      loading: false,
      error: null,
      retry: vi.fn(),
    })
    const manifest = createFrameManifestFixture({
      cycle: '2026040900',
      generatedAt: '2026-04-09T00:00:00Z',
      scalarArtifactIds: ['rh_surface'],
      forecastHours: ['003'],
      artifacts: {
        rh_surface: createScalarArtifactFixture({
          units: '%',
          parameter: 'rh',
          level: '2m_above_ground',
        }),
      },
    })

    mocks.useManifest.mockReturnValue({
      manifest,
      loading: false,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByTestId('forecast-screen')).toHaveTextContent('2026040900')
    expect(screen.queryByText('Loading Forecast')).not.toBeInTheDocument()
    expect(screen.queryByText('Forecast Load Failed')).not.toBeInTheDocument()
    expect(mocks.workspaceProps).toEqual({
      manifest,
      availabilityIndex,
      activeModelId: 'gfs',
      modelOptions: [
        { id: 'gfs', label: 'GFS' },
        { id: 'icon', label: 'ICON' },
      ],
    })
  })
})
