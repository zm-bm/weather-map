import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { formatValidTimeLabel } from '../../forecast-time'
import {
  createForecastSelectionContextValue,
  createForecastTimeContextValue,
  createManifestFixture,
  createScalarVariableMetaFixture,
} from '../../test/fixtures'
import ForecastPanel from './ForecastPanel'

const mocks = vi.hoisted(() => ({
  activeScalar: 'tmp_surface' as 'tmp_surface' | 'rh_surface',
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
    getScalarUnitOptionId: (variableId: string, fallbackOptionId: string) => (
      variableId === 'tmp_surface' ? 'fahrenheit' : fallbackOptionId
    ),
    getVectorUnitOptionId: (_variableId: string, fallbackOptionId: string) => fallbackOptionId,
    }
  )
}

function createPanelTimeContextValue() {
  return createForecastTimeContextValue(
    manifest,
    {
      cycle: '2026042113',
      forecastHours: ['000', '003', '006'],
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 21, 16, 0),
        targetTimeMs: Date.UTC(2026, 3, 21, 16, 0),
      },
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

vi.mock('../../forecast-time/ForecastTimeContext', () => ({
  useForecastTimeContext: () => createPanelTimeContextValue(),
}))

describe('ForecastPanel', () => {
  it('shows a click prompt before any map sample exists', () => {
    mocks.activeScalar = 'tmp_surface'
    mocks.lastProbe = null
    mocks.currentScalarProbeFrame = null

    render(<ForecastPanel />)

    expect(screen.getByText('Click Map')).toBeInTheDocument()
    expect(screen.getByText(formatValidTimeLabel(Date.UTC(2026, 3, 21, 16, 0)) ?? '')).toBeInTheDocument()
    expect(screen.getByText('-- / --')).toBeInTheDocument()
    expect(screen.getByText('Click map to sample current layer')).toBeInTheDocument()
  })

  it('shows the last clicked coordinate and value', () => {
    mocks.activeScalar = 'tmp_surface'
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

  it('shows a loading message while the selected scalar has not synced yet', () => {
    mocks.activeScalar = 'rh_surface'
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
    expect(screen.getByText('Loading current layer')).toBeInTheDocument()
  })
})
