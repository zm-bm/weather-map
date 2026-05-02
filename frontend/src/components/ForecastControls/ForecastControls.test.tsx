import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asScalarVariableId } from '../../manifest'
import {
  createManifestFixture,
  createScalarVariableMetaFixture,
  renderWithForecastSelection,
} from '../../test/fixtures'
import ForecastControls from './ForecastControls'

function createForecastControlsManifest(
  activeScalar: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface',
  cycle = '2026041100'
) {
  return createManifestFixture({
    cycle,
    scalarVariables: Array.from(new Set([activeScalar, 'tmp_surface', 'aptmp_surface', 'prmsl_surface'])),
    scalarVariableGroups: [
      {
        id: 'temperature',
        label: 'Temperature',
        defaultVariable: asScalarVariableId('tmp_surface'),
        variables: [asScalarVariableId('tmp_surface'), asScalarVariableId('aptmp_surface')],
      },
      {
        id: 'pressure',
        label: 'Pressure',
        defaultVariable: asScalarVariableId('prmsl_surface'),
        variables: [asScalarVariableId('prmsl_surface')],
      },
    ],
    vectorVariables: ['wind10m_uv', 'gust10m_uv'],
    variableMeta: {
      tmp_surface: createScalarVariableMetaFixture(),
      aptmp_surface: createScalarVariableMetaFixture({
        parameter: 'aptmp',
      }),
      prmsl_surface: createScalarVariableMetaFixture({
        units: 'Pa',
        parameter: 'pressure',
        valid_min: 98000,
        valid_max: 103500,
      }),
    },
  })
}

function renderForecastControls(
  activeScalar: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface' = 'tmp_surface',
  cycle?: string
) {
  return renderWithForecastSelection(
    <ForecastControls />,
    createForecastControlsManifest(activeScalar, cycle)
  )
}

describe('ForecastControls', () => {
  it('shows quiet model and UTC run hour metadata', () => {
    renderForecastControls('tmp_surface', '2026041118')

    expect(screen.getByLabelText('Forecast controls')).toBeInTheDocument()
    expect(screen.getByLabelText('Forecast level Surface, forecast model GFS, model run Apr 11, 18Z')).toHaveTextContent(/GFS.18Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('gfs')
    expect(screen.getByLabelText('Forecast level')).toHaveValue('surface')
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveTextContent('Temp')
    expect(screen.getByLabelText('Measurement')).toHaveTextContent('Temperature')
    expect(screen.queryByText('Forecast Layer')).not.toBeInTheDocument()
    expect(screen.queryByText('Model')).not.toBeInTheDocument()
    expect(screen.queryByText('Run')).not.toBeInTheDocument()
  })

  it('updates active scalar through category and measurement controls without rendering unit controls', () => {
    renderForecastControls('tmp_surface')

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(measurement.value).toBe('tmp_surface')

    fireEvent.change(measurement, {
      target: { value: 'aptmp_surface' },
    })
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('aptmp_surface')

    fireEvent.click(screen.getByRole('button', { name: 'Pressure' }))
    expect(screen.getByRole('button', { name: 'Pressure' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('prmsl_surface')

    fireEvent.click(screen.getByRole('button', { name: 'Temperature' }))
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('tmp_surface')

    expect(screen.queryByLabelText('Scalar units')).not.toBeInTheDocument()
  })
})
