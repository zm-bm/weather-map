import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
  renderWithForecastSelection,
} from '@/test/fixtures'
import LegendPanel from './LegendPanel'

type LegendLayerId =
  | 'temperature'
  | 'air_pressure'
  | 'precipitation_rate'
  | 'accumulated_precipitation'
  | 'cloud_cover'
  | 'cloud_layers'
  | 'wind_speed'
  | 'composite_reflectivity'

function createLegendSelectionManifest() {
  return createManifestFixture({
    cycle: '2026041100',
    scalarArtifactIds: [
      'tmp_surface',
      'prmsl_msl',
      'prate_surface',
      'precip_total_surface',
      'tcdc',
      'refc_entire_atmosphere',
    ],
    vectorArtifactIds: ['wind10m_uv', 'cloud_layers'],
    artifacts: {
      tmp_surface: createScalarArtifactFixture({
      }),
      prmsl_msl: createScalarArtifactFixture({
        id: 'prmsl_msl',
        units: 'Pa',
        parameter: 'prmsl',
      }),
      prate_surface: createScalarArtifactFixture({
        units: 'mm/hr',
        parameter: 'prate',
      }),
      precip_total_surface: createScalarArtifactFixture({
        id: 'precip_total_surface',
        units: 'mm',
        parameter: 'apcp',
      }),
      tcdc: createScalarArtifactFixture({
        id: 'tcdc',
        units: '%',
        parameter: 'tcdc',
      }),
      refc_entire_atmosphere: createScalarArtifactFixture({
        id: 'refc_entire_atmosphere',
        units: 'dBZ',
        parameter: 'refc',
      }),
      wind10m_uv: createVectorArtifactFixture({
        id: 'wind10m_uv',
        units: 'm/s',
        parameter: 'wind',
        components: ['u', 'v'],
      }),
      cloud_layers: createVectorArtifactFixture({
        id: 'cloud_layers',
        units: '%',
        parameter: 'cloud_layers',
        components: ['low', 'middle', 'high'],
      }),
    },
  })
}

function renderLegendHarness(selectedLayerId: LegendLayerId = 'temperature') {
  return renderWithForecastSelection(
    <LegendPanel />,
    createLegendSelectionManifest(),
    { selectedLayerId }
  )
}

describe('LegendPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses the gradient bar as the global imperial/metric unit toggle', () => {
    const { container, unmount } = renderLegendHarness('temperature')

    const temperatureToggle = screen.getByRole('button', { name: /cycle temperature units/i })
    expect(temperatureToggle).toHaveTextContent('F')

    fireEvent.click(temperatureToggle)
    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('C')

    expect(container).toHaveTextContent('50')
    expect(container).not.toHaveTextContent(' C')

    unmount()
    renderLegendHarness('precipitation_rate')

    expect(screen.getByRole('button', { name: /cycle precipitation rate units/i })).toHaveTextContent('mm/hr')

    fireEvent.click(screen.getByRole('button', { name: /cycle precipitation rate units/i }))
    expect(screen.getByRole('button', { name: /cycle precipitation rate units/i })).toHaveTextContent('in/hr')
  })

  it('shows a static hPa unit readout for air pressure', () => {
    renderLegendHarness('air_pressure')
    const scale = screen.getByLabelText('Air Pressure units hPa.')

    expect(scale).toHaveTextContent('hPa')
  })

  it('uses rounded imperial precipitation tick labels without repeated units by default', () => {
    const { container } = renderLegendHarness('precipitation_rate')
    const tickLabels = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((element) => element.textContent ?? '')
      .join(' ')

    expect(tickLabels).toContain('1')
    expect(tickLabels).toContain('0.7')
    expect(tickLabels).toContain('0.3')
    expect(tickLabels).not.toContain('in/hr')
    expect(tickLabels).not.toContain('mm/hr')
    expect(tickLabels).not.toContain('0.000')
  })

  it('uses the standard gradient bar for total sky cover', () => {
    const { container } = renderLegendHarness('cloud_cover')
    const scale = screen.getByLabelText('Total/Sky Cover units %.')

    expect(scale).toHaveTextContent('%')
    expect(container).toHaveTextContent('0')
    expect(container).toHaveTextContent('10')
    expect(container).toHaveTextContent('90')
    expect(container).toHaveTextContent('100')
  })

  it('shows a custom layer-tone legend for cloud layers', () => {
    renderLegendHarness('cloud_layers')

    expect(screen.getByLabelText('Low, middle, and high cloud layer opacity from 0 to 100 percent')).toBeInTheDocument()
    expect(screen.getByLabelText('Low cloud layer opacity units %.')).toBeInTheDocument()
    expect(screen.getByLabelText('Middle cloud layer opacity units %.')).toBeInTheDocument()
    expect(screen.getByLabelText('High cloud layer opacity units %.')).toBeInTheDocument()
    expect(screen.getByText('LOW')).toBeInTheDocument()
    expect(screen.getByText('MID')).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
  })
})
