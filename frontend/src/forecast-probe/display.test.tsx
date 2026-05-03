import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  createForecastSelectionContextValue,
  createManifestFixture,
  createScalarProductFixture,
} from '../test/fixtures'
import { formatForecastProbeValue, useForecastProbeValueFormatter } from './display'

const mocks = vi.hoisted(() => ({
  selectionContext: null as unknown,
}))

vi.mock('../forecast-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-selection')>()
  return {
    ...actual,
    useLoadedForecastSelectionContext: () => mocks.selectionContext,
  }
})

const manifest = createManifestFixture({
  cycle: '2026041100',
  scalarProducts: ['tmp_surface', 'rh_surface', 'prmsl_surface', 'prate_surface'],
  vectorProducts: ['wind10m_uv'],
  products: {
    tmp_surface: createScalarProductFixture({
      label: 'Temperature',
    }),
    rh_surface: createScalarProductFixture({
      label: 'Relative Humidity',
      units: '%',
      parameter: 'rh',
      valueRange: { min: 0, max: 100 },
    }),
    prmsl_surface: createScalarProductFixture({
      label: 'Pressure',
      units: 'Pa',
      parameter: 'prmsl',
      valueRange: { min: 98_000, max: 103_500 },
    }),
    prate_surface: createScalarProductFixture({
      label: 'Precipitation Rate',
      units: 'mm/hr',
      parameter: 'prate',
      valueRange: { min: 0, max: 30 },
    }),
  },
})

function renderDisplayHook(options: {
  activeScalar?: 'tmp_surface' | 'rh_surface' | 'prmsl_surface' | 'prate_surface'
  unitSystem?: 'imperial' | 'metric'
} = {}) {
  mocks.selectionContext = createForecastSelectionContextValue(
    manifest,
    {
      activeScalar: options.activeScalar ?? 'tmp_surface',
      unitSystem: options.unitSystem ?? 'imperial',
    }
  )

  return renderHook(() => useForecastProbeValueFormatter())
}

describe('probe value display', () => {
  it('formats the converted imperial temperature value', () => {
    const { result } = renderDisplayHook()

    expect(result.current(20).text).toBe('68 F')
  })

  it('formats the converted metric temperature value', () => {
    const { result } = renderDisplayHook({ unitSystem: 'metric' })

    expect(result.current(20).text).toBe('20 C')
  })

  it('rounds percentage values to whole numbers', () => {
    const { result } = renderDisplayHook({ activeScalar: 'rh_surface' })

    expect(result.current(55.25).text).toBe('55 %')
  })

  it('rounds pressure values to whole numbers after conversion', () => {
    const { result } = renderDisplayHook({ activeScalar: 'prmsl_surface' })

    expect(result.current(101_325).text).toBe('1013 hPa')
  })

  it('formats precipitation values with two fixed decimal places', () => {
    const { result } = renderDisplayHook({ activeScalar: 'prate_surface' })

    expect(result.current(2.54).text).toBe('0.10 in/hr')
  })

  it('formats metric precipitation values with two fixed decimal places', () => {
    const { result } = renderDisplayHook({
      activeScalar: 'prate_surface',
      unitSystem: 'metric',
    })

    expect(result.current(2.5).text).toBe('2.50 mm/hr')
  })

  it('omits the unit while a sample is loading', () => {
    const { result } = renderDisplayHook()

    expect(result.current(null, true).text).toBe('Loading')
  })

  it('formats null probe values as no data', () => {
    const { result } = renderDisplayHook()

    expect(result.current(null).text).toBe('No data')
  })
})

describe('formatForecastProbeValue', () => {
  it('keeps compact decimal precision for small values', () => {
    expect(formatForecastProbeValue(12.34)).toBe('12.3')
    expect(formatForecastProbeValue(12)).toBe('12')
  })

  it('drops decimals for values at least 100 in magnitude', () => {
    expect(formatForecastProbeValue(101.7)).toBe('102')
    expect(formatForecastProbeValue(-120.2)).toBe('-120')
  })
})
