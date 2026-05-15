import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FORECAST_MODEL_OPTIONS } from '../../forecast-models'
import {
  createManifestFixture,
  createScalarArtifactFixture,
  renderWithForecastSelection,
} from '../../test/fixtures'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from './LegendPanel'

function createLegendSelectionManifest(
  selectedArtifactId: 'tmp_surface' | 'prmsl_msl' | 'prate_surface' | 'low_clouds'
) {
  const scalarArtifactIds = selectedArtifactId === 'tmp_surface'
    ? ['tmp_surface', 'prate_surface']
    : [selectedArtifactId]
  return createManifestFixture({
    cycle: '2026041100',
    scalarArtifactIds,
    vectorArtifactIds: [],
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
      low_clouds: createScalarArtifactFixture({
        id: 'low_clouds',
        units: '%',
        parameter: 'low_clouds',
      }),
    },
  })
}

function renderLegendHarness(selectedArtifactId: 'tmp_surface' | 'prmsl_msl' | 'prate_surface' | 'low_clouds' = 'tmp_surface') {
  return renderWithForecastSelection(
    <>
      <ForecastPanel
        activeModelId="gfs"
        modelOptions={FORECAST_MODEL_OPTIONS}
        onActiveModelChange={() => undefined}
      />
      <LegendPanel />
    </>,
    createLegendSelectionManifest(selectedArtifactId)
  )
}

describe('LegendPanel', () => {
  it('uses the legend pill as the global imperial/metric unit toggle', () => {
    const { container } = renderLegendHarness('tmp_surface')

    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('F')

    fireEvent.click(screen.getByRole('button', { name: /cycle temperature units/i }))
    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('C')

    const tickLabelsAfterSelect = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((element) => element.textContent ?? '')
      .join(' ')
    expect(tickLabelsAfterSelect).toContain('50')
    expect(tickLabelsAfterSelect).not.toContain(' C')

    fireEvent.click(screen.getByRole('button', { name: 'Precipitation' }))
    expect(screen.getByRole('button', { name: /cycle precipitation rate units/i })).toHaveTextContent('mm/hr')

    fireEvent.click(screen.getByRole('button', { name: /cycle precipitation rate units/i }))
    expect(screen.getByRole('button', { name: /cycle precipitation rate units/i })).toHaveTextContent('in/hr')
  })

  it('shows a static hPa unit readout for air pressure', () => {
    renderLegendHarness('prmsl_msl')

    expect(screen.queryByRole('button', { name: /cycle air pressure units/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Air Pressure units hPa.')).toBeInTheDocument()
  })

  it('uses rounded imperial precipitation tick labels without repeated units by default', () => {
    const { container } = renderLegendHarness('prate_surface')

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

  it('shows normal layer legend for low clouds', () => {
    const { container } = renderLegendHarness('low_clouds')

    expect(screen.getByLabelText('Low Cloud Cover units %.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cloud layer tones')).not.toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).toBeInTheDocument()
  })
})
