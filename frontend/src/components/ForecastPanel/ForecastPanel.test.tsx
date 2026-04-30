import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  createForecastSelectionContextValue,
  createManifestFixture,
  createScalarVariableMetaFixture,
} from '../../test/fixtures'
import ForecastPanel from './ForecastPanel'

const mocks = vi.hoisted(() => ({
  activeScalar: 'tmp_surface' as 'tmp_surface' | 'rh_surface',
  unitSystem: 'imperial' as 'imperial' | 'metric',
  lastProbe: null as { lat: number; lon: number } | null,
  currentScalarProbeFrame: null as {
    lower: {
      variableId: 'tmp_surface' | 'rh_surface'
    }
  } | null,
}))

const manifest = createManifestFixture({
  cycle: '2026041100',
  scalarVariables: ['tmp_surface', 'rh_surface'],
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

function createPanelSelectionContextValue() {
  return createForecastSelectionContextValue(
    manifest,
    {
      activeScalar: mocks.activeScalar,
      unitSystem: mocks.unitSystem,
    }
  )
}

vi.mock('../../forecast-selection/ForecastSelectionContext', () => ({
  useLoadedForecastSelectionContext: () => createPanelSelectionContextValue(),
}))

vi.mock('../../map-probe/context', () => ({
  useMapProbe: () => ({
    lastProbe: mocks.lastProbe,
    setLastProbe: vi.fn(),
  }),
}))

vi.mock('../../map-probe/frame', () => ({
  useProbeFrame: () => mocks.currentScalarProbeFrame,
}))

vi.mock('../../map-probe/useProbeValue', () => ({
  useProbeValue: (activeScalar: string) => {
    if (mocks.lastProbe == null) {
      return { value: null, loading: false }
    }

    if (mocks.currentScalarProbeFrame == null || mocks.currentScalarProbeFrame.lower.variableId !== activeScalar) {
      return { value: null, loading: true }
    }

    return { value: 20, loading: false }
  },
}))

describe('ForecastPanel', () => {
  it('hides probe readouts before any map sample exists', () => {
    mocks.activeScalar = 'tmp_surface'
    mocks.unitSystem = 'imperial'
    mocks.lastProbe = null
    mocks.currentScalarProbeFrame = null

    render(<ForecastPanel />)

    expect(screen.getByLabelText('Scalar layer')).toHaveValue('tmp_surface')
    expect(screen.getByLabelText('Forecast level Surface, forecast model GFS, model run Apr 11, 00Z')).toHaveTextContent(/GFS.00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('gfs')
    expect(screen.getByLabelText('Forecast level')).toHaveValue('surface')
    expect(screen.queryByText('Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
    expect(screen.queryByText('-- / --')).not.toBeInTheDocument()
    expect(screen.queryByText('Click map')).not.toBeInTheDocument()
  })

  it('shows the last clicked coordinate and value', () => {
    mocks.activeScalar = 'tmp_surface'
    mocks.unitSystem = 'imperial'
    mocks.lastProbe = {
      lat: 35.125,
      lon: -97.5,
    }
    mocks.currentScalarProbeFrame = {
      lower: {
        variableId: 'tmp_surface',
      },
    }

    render(<ForecastPanel />)

    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('35.13 / -97.50')).toBeInTheDocument()
    expect(screen.getByText('68 F')).toBeInTheDocument()
  })

  it('uses the global unit system for sampled values', () => {
    mocks.activeScalar = 'tmp_surface'
    mocks.unitSystem = 'metric'
    mocks.lastProbe = {
      lat: 35.125,
      lon: -97.5,
    }
    mocks.currentScalarProbeFrame = {
      lower: {
        variableId: 'tmp_surface',
      },
    }

    render(<ForecastPanel />)

    expect(screen.getByText('20 C')).toBeInTheDocument()
  })

  it('shows a loading message while the selected scalar has not synced yet', () => {
    mocks.activeScalar = 'rh_surface'
    mocks.unitSystem = 'imperial'
    mocks.lastProbe = {
      lat: 35.125,
      lon: -97.5,
    }
    mocks.currentScalarProbeFrame = {
      lower: {
        variableId: 'tmp_surface',
      },
    }

    render(<ForecastPanel />)

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })
})
