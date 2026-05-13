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
  activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface' | 'low_clouds'
) {
  return createManifestFixture({
    cycle: '2026041100',
    scalarProducts: Array.from(new Set([activeScalar, 'tmp_surface', 'prmsl_surface', 'prate_surface', 'low_clouds'])),
    groups: [
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProduct: asScalarProductId('tmp_surface'),
        products: [asScalarProductId('tmp_surface')],
      },
      {
        id: 'precipitation',
        layerId: 'scalar',
        label: 'Precipitation',
        defaultProduct: asScalarProductId('prate_surface'),
        products: [asScalarProductId('prate_surface')],
      },
      {
        id: 'wind',
        layerId: 'scalar',
        label: 'Wind & Pressure',
        defaultProduct: asScalarProductId('prmsl_surface'),
        products: [asScalarProductId('prmsl_surface')],
      },
      {
        id: 'atmosphere',
        layerId: 'scalar',
        label: 'Atmosphere',
        defaultProduct: asScalarProductId('low_clouds'),
        products: [asScalarProductId('low_clouds')],
      },
    ],
    vectorProducts: ['wind10m_uv'],
    products: {
      tmp_surface: createScalarProductFixture({
        label: 'Temperature',
      }),
      prmsl_surface: createScalarProductFixture({
        label: 'Air Pressure',
        units: 'Pa',
        parameter: 'prmsl',
        valueRange: { min: 98000, max: 103500 },
      }),
      prate_surface: createScalarProductFixture({
        label: 'Precipitation Rate',
        units: 'mm/hr',
        parameter: 'prate',
        valueRange: { min: 0, max: 30 },
      }),
      low_clouds: createScalarProductFixture({
        id: asScalarProductId('low_clouds'),
        label: 'Low Clouds',
        units: '%',
        parameter: 'low_clouds',
        valueRange: { min: 0, max: 100 },
      }),
      wind10m_uv: createVectorProductFixture(),
    },
  })
}

function renderLegendHarness(activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface' | 'low_clouds' = 'tmp_surface') {
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

  it('shows a static hPa unit readout for air pressure', () => {
    renderLegendHarness('prmsl_surface')

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

  it('shows normal scalar legend for low clouds', () => {
    const { container } = renderLegendHarness('low_clouds')

    expect(screen.getByLabelText('Low Clouds units %.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cloud layer tones')).not.toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).toBeInTheDocument()
  })
})
