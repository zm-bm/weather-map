import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastModelId, ForecastModelOption } from './forecast-models'
import type { CycleManifest } from './manifest'
import { createFrameManifestFixture, createScalarArtifactFixture } from './test/fixtures'
import App from './App'

const mocks = vi.hoisted(() => ({
  useManifest: vi.fn(),
  workspaceProps: null as Record<string, unknown> | null,
}))

vi.mock('./manifest/useManifest', () => ({
  useManifest: mocks.useManifest,
}))

vi.mock('./components/ForecastShell/ForecastShell', () => ({
  default: ({
    manifest,
    activeModelId,
    modelOptions,
    onActiveModelChange,
  }: {
    manifest: CycleManifest | null
    activeModelId: ForecastModelId
    modelOptions: readonly ForecastModelOption[]
    onActiveModelChange: (modelId: ForecastModelId) => void
  }) => {
    mocks.workspaceProps = { manifest, activeModelId, modelOptions }
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

describe('App composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspaceProps = null
  })

  it('always mounts forecast shell while manifest request is in flight', () => {
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByTestId('forecast-screen')).toHaveTextContent('no-manifest')
    expect(screen.getByText('Loading Forecast')).toBeInTheDocument()
    expect(mocks.useManifest).toHaveBeenCalledWith('gfs')
    expect(mocks.workspaceProps).toEqual({
      manifest: null,
      activeModelId: 'gfs',
      modelOptions: [
        { id: 'gfs', label: 'GFS' },
        { id: 'icon', label: 'ICON' },
      ],
    })
  })

  it('shows global manifest load error and invokes retry', () => {
    const retry = vi.fn()
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

    expect(mocks.useManifest).toHaveBeenLastCalledWith('icon')
    expect(mocks.workspaceProps?.activeModelId).toBe('icon')
  })

  it('passes manifest and load state through once available', () => {
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
      activeModelId: 'gfs',
      modelOptions: [
        { id: 'gfs', label: 'GFS' },
        { id: 'icon', label: 'ICON' },
      ],
    })
  })
})
