import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ForecastDatasetId, ForecastDatasetOption, Manifest } from '@/forecast/manifest'
import {
  formatCycleRunTimeLabel,
  formatValidTimeTickLabel,
  initialForecastValidTimeMs,
} from '@/forecast/time'
import {
  createCatalogManifestFixture,
  createMultiDatasetManifestFixture,
  createManifestFixture,
  createScalarArtifactFixture,
  createActiveRunFixture,
  createVectorArtifactFixture,
  renderWithForecastSelection,
} from '@/test/fixtures'
import { FORECAST_RASTER_LAYER_GROUPS } from '@/forecast/catalog'
import { shouldIgnoreSpaceShortcut } from '@/core/keyboard'
import ForecastPanel from './ForecastPanel'

const MODEL_OPTIONS: readonly ForecastDatasetOption[] = [
  { id: 'gfs', label: 'GFS' },
  { id: 'icon', label: 'ICON' },
]

function expectedValidTimeLabel(manifest: Manifest, datasetId: ForecastDatasetId = 'gfs'): string {
  const activeRun = createActiveRunFixture(manifest, datasetId)
  return formatValidTimeTickLabel(initialForecastValidTimeMs(activeRun.latest.frames)) ?? '--'
}

function renderPanelWithManifest(
  manifest: Manifest,
  options: {
    activeDatasetId?: ForecastDatasetId
    datasetOptions?: readonly ForecastDatasetOption[]
  } = {}
) {
  return renderWithForecastSelection(<ForecastPanel />, manifest, {
    activeDatasetId: options.activeDatasetId ?? 'gfs',
    datasetOptions: options.datasetOptions ?? MODEL_OPTIONS,
  })
}

function createPanelManifest(
  scalarArtifactIds: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface'],
  options: { dataset?: { id: string, label: string } } = {}
) {
  return createManifestFixture({
    cycle: '2026041100',
    dataset: options.dataset,
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
  return renderPanelWithManifest(manifest)
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
  return renderPanelWithManifest(manifest)
}

function measurementSelect(): HTMLSelectElement {
  return screen.getByLabelText('Measurement') as HTMLSelectElement
}

function sourceSelect(): HTMLSelectElement {
  return screen.getByLabelText('Forecast source') as HTMLSelectElement
}

function selectMeasurement(value: string, select = measurementSelect()) {
  fireEvent.change(select, { target: { value } })
  return select
}

function selectSource(value: string, select = sourceSelect()) {
  fireEvent.change(select, { target: { value } })
  return select
}

function expectNoProbeReadout() {
  expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
  expect(screen.queryByText('Value')).not.toBeInTheDocument()
  expect(screen.queryByText('-- / --')).not.toBeInTheDocument()
  expect(screen.queryByText('Click map')).not.toBeInTheDocument()
}

describe('ForecastPanel', () => {
  it('renders forecast controls without probe readouts', () => {
    const manifest = createPanelManifest(['tmp_surface', 'rh_surface'])
    renderPanelWithManifest(manifest)

    const measurement = measurementSelect()
    expect(measurement).toHaveValue('temperature')
    expect(Array.from(measurement.querySelectorAll('optgroup')).map((group) => group.label))
      .toEqual(FORECAST_RASTER_LAYER_GROUPS.map((group) => group.label))
    expect(screen.getByLabelText('Forecast source GFS, forecast cycle Apr 11, 00Z')).toBeInTheDocument()
    expect(sourceSelect()).toHaveValue('gfs')
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Cycle')).toBeInTheDocument()
    expect(screen.getByText(formatCycleRunTimeLabel('2026041100') ?? '')).toBeInTheDocument()
    expect(screen.getByLabelText(/Forecast valid time/)).toHaveTextContent(expectedValidTimeLabel(manifest))
    expect(screen.queryByLabelText('Forecast level')).not.toBeInTheDocument()
    expect(screen.queryByText('Time')).not.toBeInTheDocument()
    expectNoProbeReadout()
  })

  it('updates the active forecast dataset from the dataset selector', () => {
    const catalogManifest = createCatalogManifestFixture()
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createPanelManifest(['tmp_surface', 'rh_surface'], {
        dataset: { id: 'gfs', label: 'GFS' },
      }),
      iconManifest: createPanelManifest(['tmp_surface', 'rh_surface'], {
        dataset: { id: 'icon', label: 'ICON' },
      }),
      layers: catalogManifest.layers,
    })

    renderPanelWithManifest(manifest, {
      activeDatasetId: 'icon',
    })

    expect(screen.getByLabelText('Forecast source ICON, forecast cycle Apr 11, 00Z')).toBeInTheDocument()
    const source = sourceSelect()
    expect(source).toHaveValue('icon')

    source.focus()
    expect(source).toHaveFocus()
    selectSource('gfs', source)

    expect(sourceSelect()).toHaveValue('gfs')
    expect(source).not.toHaveFocus()
  })

  it('marks panel selects as pointer-used for same-value selection playback shortcuts', () => {
    const manifest = createPanelManifest(['tmp_surface', 'rh_surface'])
    renderPanelWithManifest(manifest)

    const measurement = measurementSelect()
    expect(shouldIgnoreSpaceShortcut(measurement)).toBe(true)
    fireEvent.pointerDown(measurement)
    expect(shouldIgnoreSpaceShortcut(measurement)).toBe(false)
    fireEvent.blur(measurement)
    expect(shouldIgnoreSpaceShortcut(measurement)).toBe(true)

    const source = sourceSelect()
    expect(shouldIgnoreSpaceShortcut(source)).toBe(true)
    fireEvent.pointerDown(source)
    expect(shouldIgnoreSpaceShortcut(source)).toBe(false)
    fireEvent.blur(source)
    expect(shouldIgnoreSpaceShortcut(source)).toBe(true)
  })

  it('keeps model selection secondary to the selected measurement', () => {
    const catalogManifest = createCatalogManifestFixture()
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createManifestFixture({
        cycle: '2026041118',
        dataset: { id: 'gfs', label: 'GFS' },
        scalarArtifactIds: ['tmp_surface', 'visibility_surface'],
        vectorArtifactIds: [],
      }),
      iconManifest: createManifestFixture({
        cycle: '2026041118',
        dataset: { id: 'icon', label: 'ICON' },
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
      layers: catalogManifest.layers,
    })

    renderPanelWithManifest(manifest, {
      activeDatasetId: 'gfs',
    })

    selectMeasurement('visibility')

    expect(measurementSelect()).toHaveValue('visibility')
    expect(screen.getByRole('option', { name: 'ICON (unavailable)' })).toBeDisabled()

    selectSource('icon')

    expect(sourceSelect()).toHaveValue('gfs')
    expect(measurementSelect()).toHaveValue('visibility')
  })

  it('updates selected layer through the grouped measurement control without rendering unit controls', () => {
    renderInteractiveForecastPanel('tmp_surface')

    const measurement = measurementSelect()
    expect(measurement.value).toBe('temperature')
    expect(screen.getByRole('option', { name: 'Temperature' })).toHaveValue('temperature')
    expect(screen.getByRole('option', { name: 'Apparent Temperature' })).toHaveValue('apparent_temperature')
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()

    measurement.focus()
    expect(measurement).toHaveFocus()
    selectMeasurement('apparent_temperature', measurement)
    expect(measurementSelect().value).toBe('apparent_temperature')
    expect(measurement).not.toHaveFocus()

    selectMeasurement('wind_gust', measurement)
    expect(measurementSelect().value).toBe('wind_gust')
    expect(screen.getByRole('option', { name: 'Wind Speed' })).toHaveValue('wind_speed')
    expect(screen.getByRole('option', { name: 'Wind Gust' })).toHaveValue('wind_gust')
    expect(screen.getByRole('option', { name: 'Air Pressure' })).toHaveValue('air_pressure')

    selectMeasurement('temperature', measurement)
    expect(measurementSelect().value).toBe('temperature')

  })

  it('uses the run-total precipitation label for the accumulated precipitation layer id', () => {
    const manifest = createManifestFixture({
      cycle: '2026041118',
      scalarArtifactIds: ['tmp_surface', 'precip_total_surface'],
      vectorArtifactIds: [],
    })

    renderPanelWithManifest(manifest)

    expect(screen.getByRole('option', { name: 'Run-Total Precipitation' }))
      .toHaveValue('accumulated_precipitation')
  })

  it('keeps layer selection controls after the probe readout moves onto the map', () => {
    renderForecastPanel(['rh_surface', 'tmp_surface'])

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expectNoProbeReadout()
  })

  it('shows Cloud Layers and Total/Sky Cover as selectable cloud measurements', () => {
    const manifest = createManifestFixture({
      cycle: '2026041118',
      scalarArtifactIds: ['tcdc'],
      vectorArtifactIds: ['cloud_layers'],
      artifacts: {
        tcdc: createScalarArtifactFixture({
          units: '%',
          parameter: 'tcdc',
        }),
        cloud_layers: createVectorArtifactFixture({
          id: 'cloud_layers',
          units: '%',
          parameter: 'cloud_layers',
          components: ['low', 'middle', 'high'],
        }),
      },
    })

    renderPanelWithManifest(manifest)

    const measurement = measurementSelect()
    expect(screen.getByRole('option', { name: 'Cloud Layers' })).toHaveValue('cloud_layers')
    expect(screen.getByRole('option', { name: 'Total/Sky Cover' })).toHaveValue('cloud_cover')

    selectMeasurement('cloud_cover', measurement)

    expect(measurement.value).toBe('cloud_cover')
  })

})
