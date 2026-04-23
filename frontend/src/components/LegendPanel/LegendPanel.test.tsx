import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  createManifestFixture,
  createScalarVariableMetaFixture,
  createVectorVariableMetaFixture,
  renderWithForecastSelection,
} from '../../test/fixtures'
import ProductPanel from '../ProductPanel'
import LegendPanel from './LegendPanel'

function createLegendSelectionManifest(
  activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface'
) {
  return createManifestFixture({
    cycle: '2026041100',
    scalarVariables: Array.from(new Set([activeScalar, 'tmp_surface', 'prmsl_surface', 'prate_surface'])),
    vectorVariables: ['wind10m_uv'],
    variableMeta: {
      tmp_surface: createScalarVariableMetaFixture(),
      prmsl_surface: createScalarVariableMetaFixture({
        units: 'Pa',
        parameter: 'pressure',
        valid_min: 98000,
        valid_max: 103500,
      }),
      prate_surface: createScalarVariableMetaFixture({
        units: 'kg/m^2/s',
        parameter: 'prate',
        valid_min: 0,
        valid_max: 0.008333333,
      }),
      wind10m_uv: createVectorVariableMetaFixture(),
    },
  })
}

function renderLegendHarness(activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface' = 'tmp_surface') {
  return renderWithForecastSelection(
    <>
      <ProductPanel />
      <LegendPanel />
    </>,
    createLegendSelectionManifest(activeScalar)
  )
}

describe('LegendPanel', () => {
  it('keeps unit interaction in the legend and synchronizes with the product panel', () => {
    const { container } = renderLegendHarness('tmp_surface')

    const scalarUnits = screen.getByLabelText('Scalar units') as HTMLSelectElement
    expect(scalarUnits.value).toBe('fahrenheit')
    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('F')

    fireEvent.change(scalarUnits, {
      target: { value: 'celsius' },
    })

    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('C')

    const tickLabelsAfterSelect = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((element) => element.textContent ?? '')
      .join(' ')
    expect(tickLabelsAfterSelect).toContain('50')
    expect(tickLabelsAfterSelect).not.toContain(' C')

    fireEvent.click(screen.getByRole('button', { name: /cycle temperature units/i }))
    expect((screen.getByLabelText('Scalar units') as HTMLSelectElement).value).toBe('fahrenheit')
  })

  it('shows a static hPa unit readout for pressure', () => {
    renderLegendHarness('prmsl_surface')

    expect(screen.queryByRole('button', { name: /cycle pressure units/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Pressure units hPa.')).toBeInTheDocument()
  })

  it('uses rounded precipitation tick labels without repeated units', () => {
    const { container } = renderLegendHarness('prate_surface')

    const tickLabels = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((element) => element.textContent ?? '')
      .join(' ')

    expect(tickLabels).toContain('30')
    expect(tickLabels).toContain('15')
    expect(tickLabels).toContain('7')
    expect(tickLabels).not.toContain('mm/hr')
    expect(tickLabels).not.toContain('0.000')
  })
})
