import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FORECAST_MODEL_OPTIONS } from '../../forecast-models'
import { asScalarProductId } from '../../manifest'
import {
  createManifestFixture,
  createScalarProductFixture,
  createVectorProductFixture,
  renderWithForecastSelection,
} from '../../test/fixtures'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from './LegendPanel'

function createLegendSelectionManifest(
  activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface' | 'cloud_layers'
) {
  return createManifestFixture({
    cycle: '2026041100',
    scalarProducts: Array.from(new Set([activeScalar, 'tmp_surface', 'prmsl_surface', 'prate_surface', 'cloud_layers'])),
    groups: [
      {
        id: 'temperature',
        kind: 'scalar',
        label: 'Temperature',
        defaultProduct: asScalarProductId('tmp_surface'),
        products: [asScalarProductId('tmp_surface')],
      },
      {
        id: 'precipitation',
        kind: 'scalar',
        label: 'Precipitation',
        defaultProduct: asScalarProductId('prate_surface'),
        products: [asScalarProductId('prate_surface')],
      },
      {
        id: 'pressure',
        kind: 'scalar',
        label: 'Pressure',
        defaultProduct: asScalarProductId('prmsl_surface'),
        products: [asScalarProductId('prmsl_surface')],
      },
      {
        id: 'clouds',
        kind: 'scalar',
        label: 'Clouds',
        defaultProduct: asScalarProductId('cloud_layers'),
        products: [asScalarProductId('cloud_layers')],
      },
    ],
    vectorProducts: ['wind10m_uv'],
    products: {
      tmp_surface: createScalarProductFixture({
        label: 'Temperature',
      }),
      prmsl_surface: createScalarProductFixture({
        label: 'Pressure',
        units: 'Pa',
        parameter: 'pressure',
        valueRange: { min: 98000, max: 103500 },
      }),
      prate_surface: createScalarProductFixture({
        label: 'Precipitation Rate',
        units: 'mm/hr',
        parameter: 'prate',
        valueRange: { min: 0, max: 30 },
      }),
      cloud_layers: createScalarProductFixture({
        label: 'Cloud Layers',
        units: '%',
        parameter: 'cloud_layers',
        valueRange: { min: 0, max: 100 },
      }),
      wind10m_uv: createVectorProductFixture(),
    },
  })
}

function renderLegendHarness(activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface' | 'cloud_layers' = 'tmp_surface') {
  return renderWithForecastSelection(
    <>
      <ForecastPanel
        activeModelId="gfs"
        modelOptions={FORECAST_MODEL_OPTIONS}
        onActiveModelChange={() => undefined}
      />
      <LegendPanel />
    </>,
    createLegendSelectionManifest(activeScalar)
  )
}

describe('LegendPanel', () => {
  it('uses the legend pill as the global imperial/metric unit toggle', () => {
    const { container } = renderLegendHarness('tmp_surface')

    expect(screen.queryByLabelText('Scalar units')).not.toBeInTheDocument()
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

  it('shows a static hPa unit readout for pressure', () => {
    renderLegendHarness('prmsl_surface')

    expect(screen.queryByRole('button', { name: /cycle pressure units/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Pressure units hPa.')).toBeInTheDocument()
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

  it('shows compact cloud layer swatches for the packed cloud layer measurement', () => {
    const { container } = renderLegendHarness('cloud_layers')

    expect(screen.getByLabelText('Cloud Layers units %.')).toBeInTheDocument()
    expect(screen.getByLabelText('Cloud layer tones')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText('Mid')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).not.toBeInTheDocument()
  })
})
