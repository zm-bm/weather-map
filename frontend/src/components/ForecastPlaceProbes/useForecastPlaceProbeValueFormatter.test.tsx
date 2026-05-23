import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  createForecastSelectionContextValue,
  createManifestFixture,
  createScalarArtifactFixture,
} from '../../test/fixtures'
import { useForecastPlaceProbeValueFormatter } from './useForecastPlaceProbeValueFormatter'

const mocks = vi.hoisted(() => ({
  selectionContext: null as unknown,
}))

vi.mock('../../forecast-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../forecast-selection')>()
  return {
    ...actual,
    useLoadedForecastSelectionContext: () => mocks.selectionContext,
  }
})

const manifest = createManifestFixture({
  cycle: '2026041100',
  scalarArtifactIds: ['tmp_surface', 'rh_surface', 'prmsl_msl', 'prate_surface'],
  vectorArtifactIds: ['wind10m_uv'],
  artifacts: {
    tmp_surface: createScalarArtifactFixture(),
    rh_surface: createScalarArtifactFixture({
      units: '%',
      parameter: 'rh',
    }),
    prmsl_msl: createScalarArtifactFixture({
      id: 'prmsl_msl',
      units: 'Pa',
      parameter: 'prmsl',
    }),
    prate_surface: createScalarArtifactFixture({
      units: 'mm/hr',
      parameter: 'prate',
    }),
  },
})

function renderDisplayHook(options: {
  selectedLayerId?: 'temperature' | 'relative_humidity' | 'air_pressure' | 'precipitation_rate'
  unitSystem?: 'imperial' | 'metric'
} = {}) {
  mocks.selectionContext = createForecastSelectionContextValue(
    manifest,
    {
      selectedLayerId: options.selectedLayerId ?? 'temperature',
      unitSystem: options.unitSystem ?? 'imperial',
    }
  )

  return renderHook(() => useForecastPlaceProbeValueFormatter())
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
    const { result } = renderDisplayHook({ selectedLayerId: 'relative_humidity' })

    expect(result.current(55.25).text).toBe('55 %')
  })

  it('rounds pressure values to whole numbers after conversion', () => {
    const { result } = renderDisplayHook({ selectedLayerId: 'air_pressure' })

    expect(result.current(101_325).text).toBe('1013 hPa')
  })

  it('formats precipitation values with two fixed decimal places', () => {
    const { result } = renderDisplayHook({ selectedLayerId: 'precipitation_rate' })

    expect(result.current(2.54).text).toBe('0.10 in/hr')
  })

  it('formats metric precipitation values with two fixed decimal places', () => {
    const { result } = renderDisplayHook({
      selectedLayerId: 'precipitation_rate',
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
