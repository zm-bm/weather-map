import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  createManifestFixture,
  createScalarVariableMetaFixture,
  renderWithForecastSelection,
} from '../../test/fixtures'
import ProductPanel from './ProductPanel'

function createProductSelectionManifest(activeScalar: 'tmp_surface' | 'prmsl_surface') {
  return createManifestFixture({
    cycle: '2026041100',
    scalarVariables: Array.from(new Set([activeScalar, 'tmp_surface', 'prmsl_surface'])),
    vectorVariables: ['wind10m_uv', 'gust10m_uv'],
    variableMeta: {
      tmp_surface: createScalarVariableMetaFixture(),
      prmsl_surface: createScalarVariableMetaFixture({
        units: 'Pa',
        parameter: 'pressure',
        valid_min: 98000,
        valid_max: 103500,
      }),
    },
  })
}

function renderProductPanel(activeScalar: 'tmp_surface' | 'prmsl_surface' = 'tmp_surface') {
  return renderWithForecastSelection(<ProductPanel />, createProductSelectionManifest(activeScalar))
}

describe('ProductPanel', () => {
  it('updates active scalar and shared scalar units through the row controls', () => {
    renderProductPanel('tmp_surface')

    const scalarLayer = screen.getByLabelText('Scalar layer') as HTMLSelectElement
    expect(scalarLayer.value).toBe('tmp_surface')

    fireEvent.change(scalarLayer, {
      target: { value: 'prmsl_surface' },
    })
    expect((screen.getByLabelText('Scalar layer') as HTMLSelectElement).value).toBe('prmsl_surface')

    fireEvent.change(scalarLayer, {
      target: { value: 'tmp_surface' },
    })

    const scalarUnits = screen.getByLabelText('Scalar units') as HTMLSelectElement
    expect(scalarUnits.value).toBe('fahrenheit')

    fireEvent.change(scalarUnits, {
      target: { value: 'celsius' },
    })

    expect((screen.getByLabelText('Scalar units') as HTMLSelectElement).value).toBe('celsius')
  })

  it('shows a static scalar unit readout when only one unit is available', () => {
    renderProductPanel('prmsl_surface')

    expect(screen.queryByLabelText('Scalar units')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Scalar units hPa')).toHaveTextContent('hPa')
  })
})
