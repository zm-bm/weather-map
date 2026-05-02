import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asScalarVariableId } from '../../manifest'
import {
  createManifestFixture,
  createScalarVariableMetaFixture,
} from '../../test/fixtures'
import { ForecastSelectionProvider } from '../../forecast-selection'
import ForecastPanel from './ForecastPanel'

function createPanelManifest(scalarVariables: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface']) {
  return createManifestFixture({
    cycle: '2026041100',
    scalarVariables,
    scalarVariableGroups: [
      {
        id: 'temperature',
        label: 'Temperature',
        defaultVariable: asScalarVariableId('tmp_surface'),
        variables: [asScalarVariableId('tmp_surface')],
      },
      {
        id: 'moisture',
        label: 'Moisture',
        defaultVariable: asScalarVariableId('rh_surface'),
        variables: [asScalarVariableId('rh_surface')],
      },
    ],
    vectorVariables: ['wind10m_uv'],
    variableMeta: {
      tmp_surface: createScalarVariableMetaFixture(),
      rh_surface: createScalarVariableMetaFixture({
        units: '%',
        parameter: 'rh',
        valid_min: 0,
        valid_max: 100,
      }),
    },
  })
}

function renderForecastPanel(scalarVariables: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface']) {
  return render(
    <ForecastSelectionProvider manifest={createPanelManifest(scalarVariables)}>
      <ForecastPanel />
    </ForecastSelectionProvider>
  )
}

function createInteractivePanelManifest(
  activeScalar: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface',
  cycle = '2026041118'
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

function renderInteractiveForecastPanel(
  activeScalar: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface' = 'tmp_surface',
  cycle?: string
) {
  return render(
    <ForecastSelectionProvider manifest={createInteractivePanelManifest(activeScalar, cycle)}>
      <ForecastPanel />
    </ForecastSelectionProvider>
  )
}

describe('ForecastPanel', () => {
  it('renders forecast controls without probe readouts', () => {
    renderForecastPanel(['tmp_surface', 'rh_surface'])

    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Measurement')).toHaveValue('tmp_surface')
    expect(screen.getByLabelText('Forecast model GFS, forecast cycle initialized Apr 11, 00Z')).toHaveTextContent(/GFSCYCLE APR 11 00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('gfs')
    expect(screen.getByText('CYCLE APR 11 00Z')).toBeInTheDocument()
    expect(screen.queryByLabelText('Forecast level')).not.toBeInTheDocument()
    expect(screen.queryByText('Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
    expect(screen.queryByText('-- / --')).not.toBeInTheDocument()
    expect(screen.queryByText('Click map')).not.toBeInTheDocument()
  })

  it('updates active scalar through category and measurement controls without rendering unit controls', () => {
    renderInteractiveForecastPanel('tmp_surface')

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveTextContent('Temp')
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

  it('keeps scalar selection controls after the probe readout moves onto the map', () => {
    renderForecastPanel(['rh_surface', 'tmp_surface'])

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
  })
})
