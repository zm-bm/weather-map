import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asScalarVariableId } from '../../manifest'
import {
  createManifestFixture,
  createScalarVariableMetaFixture,
  createVectorVariableMetaFixture,
  renderWithForecastSelection,
} from '../../test/fixtures'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from './LegendPanel'

function createLegendSelectionManifest(
  activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface'
) {
  return createManifestFixture({
    cycle: '2026041100',
    scalarVariables: Array.from(new Set([activeScalar, 'tmp_surface', 'prmsl_surface', 'prate_surface'])),
    scalarVariableGroups: [
      {
        id: 'temperature',
        label: 'Temperature',
        defaultVariable: asScalarVariableId('tmp_surface'),
        variables: [asScalarVariableId('tmp_surface')],
      },
      {
        id: 'precipitation',
        label: 'Precipitation',
        defaultVariable: asScalarVariableId('prate_surface'),
        variables: [asScalarVariableId('prate_surface')],
      },
      {
        id: 'pressure',
        label: 'Pressure',
        defaultVariable: asScalarVariableId('prmsl_surface'),
        variables: [asScalarVariableId('prmsl_surface')],
      },
    ],
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
        units: 'mm/hr',
        parameter: 'prate',
        valid_min: 0,
        valid_max: 30,
      }),
      wind10m_uv: createVectorVariableMetaFixture(),
    },
  })
}

function renderLegendHarness(activeScalar: 'tmp_surface' | 'prmsl_surface' | 'prate_surface' = 'tmp_surface') {
  return renderWithForecastSelection(
    <>
      <ForecastPanel />
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
})
