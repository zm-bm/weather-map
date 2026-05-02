import { render, screen } from '@testing-library/react'
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

describe('ForecastPanel', () => {
  it('renders forecast controls without probe readouts', () => {
    renderForecastPanel(['tmp_surface', 'rh_surface'])

    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Measurement')).toHaveValue('tmp_surface')
    expect(screen.getByLabelText('Forecast level Surface, forecast model GFS, model run Apr 11, 00Z')).toHaveTextContent(/GFS.00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('gfs')
    expect(screen.getByLabelText('Forecast level')).toHaveValue('surface')
    expect(screen.queryByText('Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
    expect(screen.queryByText('-- / --')).not.toBeInTheDocument()
    expect(screen.queryByText('Click map')).not.toBeInTheDocument()
  })

  it('keeps scalar selection controls after the probe readout moves onto the map', () => {
    renderForecastPanel(['rh_surface', 'tmp_surface'])

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
  })
})
