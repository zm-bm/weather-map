import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { formatValidLabel } from '../../forecast-time/format'
import { createManifestFixture, createScalarVariableMetaFixture } from '../../test/fixtures'
import ForecastPanel from './ForecastPanel'

const mocks = vi.hoisted(() => ({
  lastProbe: null as { lat: number; lon: number; value: number | null; variableId: 'tmp_surface' | 'rh_surface' | null } | null,
}))

vi.mock('../../forecast-selection/ForecastSelectionContext', () => ({
  useLoadedForecastSelectionContext: () => {
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

    return {
      manifest,
      cycle: manifest.cycle,
      scalarVariables: manifest.scalarVariables,
      vectorVariables: manifest.vectorVariables,
      variableMeta: manifest.variableMeta,
      activeScalar: manifest.scalarVariables[0],
      activeVector: manifest.vectorVariables[0],
      setActiveScalar: vi.fn(),
      setActiveVector: vi.fn(),
      scalarUnitOptionIds: {},
      vectorUnitOptionIds: {},
      getScalarUnitOptionId: (variableId: string, fallbackOptionId: string) => (
        variableId === 'tmp_surface' ? 'fahrenheit' : fallbackOptionId
      ),
      getVectorUnitOptionId: (_variableId: string, fallbackOptionId: string) => fallbackOptionId,
      setScalarUnitOptionId: vi.fn(),
      setVectorUnitOptionId: vi.fn(),
    }
  },
}))

vi.mock('../../map-probe/MapProbeContext', () => ({
  useMapProbe: () => ({
    lastProbe: mocks.lastProbe,
    setLastProbe: vi.fn(),
  }),
}))

vi.mock('../../forecast-time/ForecastTimeContext', () => ({
  useForecastTimeContext: () => ({
    cycle: '2026042113',
    forecastHours: ['000', '003', '006'],
    state: {
      appliedHourIndex: 1,
      targetHourIndex: 1,
      pendingHourIndex: null,
      isInFlight: false,
      isPlaying: false,
    },
    controls: {
      requestHour: vi.fn(),
      requestPrev: vi.fn(),
      requestNext: vi.fn(),
      togglePlay: vi.fn(),
    },
    sync: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    },
  }),
}))

describe('ForecastPanel', () => {
  it('shows a click prompt before any map sample exists', () => {
    mocks.lastProbe = null

    render(<ForecastPanel />)

    expect(screen.getByText('Click Map')).toBeInTheDocument()
    expect(screen.getByText(formatValidLabel('2026042113', '003') ?? '')).toBeInTheDocument()
    expect(screen.getByText('-- / --')).toBeInTheDocument()
    expect(screen.getByText('Click map to sample current layer')).toBeInTheDocument()
  })

  it('shows the last clicked coordinate and value', () => {
    mocks.lastProbe = {
      lat: 35.125,
      lon: -97.5,
      value: 25,
      variableId: 'tmp_surface',
    }

    render(<ForecastPanel />)

    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('35.13 / -97.50')).toBeInTheDocument()
    expect(screen.getByText('77 F')).toBeInTheDocument()
  })
})
