import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FORECAST_MODEL_OPTIONS, type ForecastModelId } from '../../forecast-models'
import {
  createManifestFixture,
  createScalarArtifactFixture,
} from '../../test/fixtures'
import { ForecastSelectionProvider } from '../../forecast-selection'
import ForecastPanel from './ForecastPanel'

function createForecastPanelProps(overrides: {
  activeModelId?: ForecastModelId
  onActiveModelChange?: (modelId: ForecastModelId) => void
} = {}) {
  return {
    activeModelId: overrides.activeModelId ?? 'gfs',
    modelOptions: FORECAST_MODEL_OPTIONS,
    onActiveModelChange: overrides.onActiveModelChange ?? vi.fn(),
  }
}

function createPanelManifest(
  scalarArtifactIds: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface'],
  options: { model?: { id: string, label: string } } = {}
) {
  return createManifestFixture({
    cycle: '2026041100',
    model: options.model,
    scalarArtifactIds,
    vectorArtifactIds: ['wind10m_uv'],
    artifacts: {
      tmp_surface: createScalarArtifactFixture(),
      rh_surface: createScalarArtifactFixture({
        units: '%',
        parameter: 'rh',
      }),
    },
  })
}

function renderForecastPanel(scalarArtifactIds: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface']) {
  return render(
    <ForecastSelectionProvider manifest={createPanelManifest(scalarArtifactIds)}>
      <ForecastPanel {...createForecastPanelProps()} />
    </ForecastSelectionProvider>
  )
}

function createInteractivePanelManifest(
  selectedLayerId: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface',
  cycle = '2026041118'
) {
  return createManifestFixture({
    cycle,
    scalarArtifactIds: Array.from(new Set([selectedLayerId, 'tmp_surface', 'aptmp_surface', 'prmsl_surface'])),
    vectorArtifactIds: ['wind10m_uv', 'gust10m_uv'],
    artifacts: {
      tmp_surface: createScalarArtifactFixture(),
      aptmp_surface: createScalarArtifactFixture({
        parameter: 'aptmp',
      }),
      prmsl_surface: createScalarArtifactFixture({
        units: 'Pa',
        parameter: 'prmsl',
      }),
    },
  })
}

function renderInteractiveForecastPanel(
  selectedLayerId: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface' = 'tmp_surface',
  cycle?: string
) {
  return render(
    <ForecastSelectionProvider manifest={createInteractivePanelManifest(selectedLayerId, cycle)}>
      <ForecastPanel {...createForecastPanelProps()} />
    </ForecastSelectionProvider>
  )
}

describe('ForecastPanel', () => {
  it('renders forecast controls without probe readouts', () => {
    renderForecastPanel(['tmp_surface', 'rh_surface'])

    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Measurement')).toHaveValue('tmp_surface')
    expect(screen.getByLabelText('Forecast model GFS, forecast cycle initialized Apr 11, 00Z')).toHaveTextContent(/CYCLE APR 11 00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('gfs')
    expect(screen.getByText('CYCLE APR 11 00Z')).toBeInTheDocument()
    expect(screen.queryByLabelText('Forecast level')).not.toBeInTheDocument()
    expect(screen.queryByText('Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
    expect(screen.queryByText('-- / --')).not.toBeInTheDocument()
    expect(screen.queryByText('Click map')).not.toBeInTheDocument()
  })

  it('updates the active forecast model from the model selector', () => {
    const onActiveModelChange = vi.fn()

    render(
      <ForecastSelectionProvider
        manifest={createPanelManifest(['tmp_surface', 'rh_surface'], {
          model: { id: 'icon', label: 'ICON' },
        })}
      >
        <ForecastPanel
          {...createForecastPanelProps({
            activeModelId: 'icon',
            onActiveModelChange,
          })}
        />
      </ForecastSelectionProvider>
    )

    expect(screen.getByLabelText('Forecast model ICON, forecast cycle initialized Apr 11, 00Z')).toHaveTextContent(/ICONCYCLE APR 11 00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('icon')

    fireEvent.change(screen.getByLabelText('Forecast model'), {
      target: { value: 'gfs' },
    })

    expect(onActiveModelChange).toHaveBeenCalledWith('gfs')
  })

  it('updates selected layer through category and measurement controls without rendering unit controls', () => {
    renderInteractiveForecastPanel('tmp_surface')

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveTextContent('Temperature')
    expect(measurement.value).toBe('tmp_surface')
    expect(screen.getByRole('option', { name: 'Temperature' })).toHaveValue('tmp_surface')
    expect(screen.getByRole('option', { name: 'Apparent Temperature' })).toHaveValue('aptmp_surface')
    expect(screen.queryByRole('option', { name: 'tmp_surface' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'aptmp_surface' })).not.toBeInTheDocument()

    fireEvent.change(measurement, {
      target: { value: 'aptmp_surface' },
    })
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('aptmp_surface')

    fireEvent.click(screen.getByRole('button', { name: 'Wind & Pressure' }))
    expect(screen.getByRole('button', { name: 'Wind & Pressure' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('wind_speed_surface')
    expect(screen.getByRole('option', { name: 'Wind Speed' })).toHaveValue('wind_speed_surface')
    expect(screen.getByRole('option', { name: 'Air Pressure' })).toHaveValue('prmsl_surface')

    fireEvent.click(screen.getByRole('button', { name: 'Temperature' }))
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('tmp_surface')

  })

  it('keeps layer selection controls after the probe readout moves onto the map', () => {
    renderForecastPanel(['rh_surface', 'tmp_surface'])

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
  })

  it('shows low medium and high clouds as Atmosphere measurement options', () => {
    render(
      <ForecastSelectionProvider
        manifest={createManifestFixture({
          cycle: '2026041118',
          scalarArtifactIds: ['tcdc', 'low_clouds', 'medium_clouds', 'high_clouds'],
          vectorArtifactIds: [],
          artifacts: {
            tcdc: createScalarArtifactFixture({
              units: '%',
              parameter: 'tcdc',
            }),
            low_clouds: createScalarArtifactFixture({
              id: 'low_clouds',
              units: '%',
              parameter: 'low_clouds',
            }),
            medium_clouds: createScalarArtifactFixture({
              id: 'medium_clouds',
              units: '%',
              parameter: 'medium_clouds',
            }),
            high_clouds: createScalarArtifactFixture({
              id: 'high_clouds',
              units: '%',
              parameter: 'high_clouds',
            }),
          },
        })}
      >
        <ForecastPanel {...createForecastPanelProps()} />
      </ForecastSelectionProvider>
    )

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Atmosphere' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('option', { name: 'Low Clouds' })).toHaveValue('low_clouds')
    expect(screen.getByRole('option', { name: 'Medium Clouds' })).toHaveValue('medium_clouds')
    expect(screen.getByRole('option', { name: 'High Clouds' })).toHaveValue('high_clouds')

    fireEvent.change(measurement, {
      target: { value: 'medium_clouds' },
    })

    expect(measurement.value).toBe('medium_clouds')
  })
})
