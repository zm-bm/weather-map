import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ForecastModelOption } from '../../forecast-manifest'
import {
  createCatalogManifestFixture,
  createMultiModelManifestFixture,
  createManifestFixture,
  createScalarArtifactFixture,
  createActiveRunFixture,
} from '../../test/fixtures'
import { ForecastSelectionProvider } from '../../forecast-selection'
import ForecastPanel from './ForecastPanel'

const MODEL_OPTIONS: readonly ForecastModelOption[] = [
  { id: 'gfs', label: 'GFS' },
  { id: 'icon', label: 'ICON' },
]

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
  const manifest = createPanelManifest(scalarArtifactIds)
  return render(
    <ForecastSelectionProvider
      activeRun={createActiveRunFixture(manifest, 'gfs')}
      modelOptions={MODEL_OPTIONS}
    >
      <ForecastPanel />
    </ForecastSelectionProvider>
  )
}

function createInteractivePanelManifest(
  selectedArtifactId: 'tmp_surface' | 'aptmp_surface' | 'prmsl_msl',
  cycle = '2026041118'
) {
  return createManifestFixture({
    cycle,
    scalarArtifactIds: Array.from(new Set([selectedArtifactId, 'tmp_surface', 'aptmp_surface', 'gust_surface', 'prmsl_msl'])),
    vectorArtifactIds: ['wind10m_uv', 'gust10m_uv'],
    artifacts: {
      tmp_surface: createScalarArtifactFixture(),
      aptmp_surface: createScalarArtifactFixture({
        parameter: 'aptmp',
      }),
      gust_surface: createScalarArtifactFixture({
        id: 'gust_surface',
        parameter: 'gust',
      }),
      prmsl_msl: createScalarArtifactFixture({
        id: 'prmsl_msl',
        units: 'Pa',
        parameter: 'prmsl',
      }),
    },
  })
}

function renderInteractiveForecastPanel(
  selectedArtifactId: 'tmp_surface' | 'aptmp_surface' | 'prmsl_msl' = 'tmp_surface',
  cycle?: string
) {
  const manifest = createInteractivePanelManifest(selectedArtifactId, cycle)
  return render(
    <ForecastSelectionProvider
      activeRun={createActiveRunFixture(manifest, 'gfs')}
      modelOptions={MODEL_OPTIONS}
    >
      <ForecastPanel />
    </ForecastSelectionProvider>
  )
}

describe('ForecastPanel', () => {
  it('renders forecast controls without probe readouts', () => {
    renderForecastPanel(['tmp_surface', 'rh_surface'])

    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Measurement')).toHaveValue('temperature')
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
    const catalogManifest = createCatalogManifestFixture()
    const manifest = createMultiModelManifestFixture({
      gfsManifest: createPanelManifest(['tmp_surface', 'rh_surface'], {
        model: { id: 'gfs', label: 'GFS' },
      }),
      iconManifest: createPanelManifest(['tmp_surface', 'rh_surface'], {
        model: { id: 'icon', label: 'ICON' },
      }),
      layers: catalogManifest.layers,
    })

    render(
      <ForecastSelectionProvider
        activeRun={createActiveRunFixture(manifest, 'icon')}
        modelOptions={MODEL_OPTIONS}
        onActiveModelChange={onActiveModelChange}
      >
        <ForecastPanel />
      </ForecastSelectionProvider>
    )

    expect(screen.getByLabelText('Forecast model ICON, forecast cycle initialized Apr 11, 00Z')).toHaveTextContent(/ICONCYCLE APR 11 00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('icon')

    fireEvent.change(screen.getByLabelText('Forecast model'), {
      target: { value: 'gfs' },
    })

    expect(onActiveModelChange).toHaveBeenCalledWith('gfs')
  })

  it('keeps model selection secondary to the selected measurement', () => {
    const onActiveModelChange = vi.fn()
    const catalogManifest = createCatalogManifestFixture()
    const manifest = createMultiModelManifestFixture({
      gfsManifest: null,
      iconManifest: createManifestFixture({
        cycle: '2026041118',
        model: { id: 'icon', label: 'ICON' },
        scalarArtifactIds: ['tmp_surface', 'prate_surface', 'precip_total_surface'],
        vectorArtifactIds: [],
      }),
      layers: catalogManifest.layers,
    })

    render(
      <ForecastSelectionProvider
        activeRun={createActiveRunFixture(manifest, 'icon')}
        modelOptions={MODEL_OPTIONS}
        onActiveModelChange={onActiveModelChange}
      >
        <ForecastPanel />
      </ForecastSelectionProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Precipitation' }))
    fireEvent.change(screen.getByLabelText('Measurement'), {
      target: { value: 'accumulated_precipitation' },
    })

    expect(screen.getByLabelText('Measurement')).toHaveValue('accumulated_precipitation')
    expect(screen.getByRole('option', { name: 'GFS (unavailable)' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Forecast model'), {
      target: { value: 'gfs' },
    })

    expect(onActiveModelChange).not.toHaveBeenCalledWith('gfs')
    expect(screen.getByLabelText('Measurement')).toHaveValue('accumulated_precipitation')
  })

  it('updates selected layer through category and measurement controls without rendering unit controls', () => {
    renderInteractiveForecastPanel('tmp_surface')

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveTextContent('Temperature')
    expect(measurement.value).toBe('temperature')
    expect(screen.getByRole('option', { name: 'Temperature' })).toHaveValue('temperature')
    expect(screen.getByRole('option', { name: 'Apparent Temperature' })).toHaveValue('apparent_temperature')

    fireEvent.change(measurement, {
      target: { value: 'apparent_temperature' },
    })
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('apparent_temperature')

    fireEvent.click(screen.getByRole('button', { name: 'Wind & Pressure' }))
    expect(screen.getByRole('button', { name: 'Wind & Pressure' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('wind_gust')
    expect(screen.getByRole('option', { name: 'Wind Speed' })).toHaveValue('wind_speed')
    expect(screen.getByRole('option', { name: 'Wind Gust' })).toHaveValue('wind_gust')
    expect(screen.getByRole('option', { name: 'Air Pressure' })).toHaveValue('air_pressure')

    fireEvent.click(screen.getByRole('button', { name: 'Temperature' }))
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('temperature')

  })

  it('keeps layer selection controls after the probe readout moves onto the map', () => {
    renderForecastPanel(['rh_surface', 'tmp_surface'])

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
  })

  it('shows low, middle, and high cloud cover as Sky & Visibility measurement options', () => {
    const manifest = createManifestFixture({
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
    })

    render(
      <ForecastSelectionProvider
        activeRun={createActiveRunFixture(manifest, 'gfs')}
        modelOptions={MODEL_OPTIONS}
      >
        <ForecastPanel />
      </ForecastSelectionProvider>
    )

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    fireEvent.click(screen.getByRole('button', { name: 'Sky & Visibility' }))
    expect(screen.getByRole('button', { name: 'Sky & Visibility' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('option', { name: 'Low Cloud Cover' })).toHaveValue('low_cloud_cover')
    expect(screen.getByRole('option', { name: 'Middle Cloud Cover' })).toHaveValue('middle_cloud_cover')
    expect(screen.getByRole('option', { name: 'High Cloud Cover' })).toHaveValue('high_cloud_cover')

    fireEvent.change(measurement, {
      target: { value: 'middle_cloud_cover' },
    })

    expect(measurement.value).toBe('middle_cloud_cover')
  })
})
