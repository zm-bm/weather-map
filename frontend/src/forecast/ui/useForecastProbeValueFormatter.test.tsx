import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useForecastProbeValueFormatter } from './useForecastProbeValueFormatter'

const mocks = vi.hoisted(() => ({
  unitSystem: 'imperial' as 'imperial' | 'metric',
}))

vi.mock('@/forecast/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/settings')>()
  return {
    ...actual,
    useForecastSettings: () => ({
      settings: {
        ...actual.DEFAULT_FORECAST_SETTINGS,
        units: {
          system: mocks.unitSystem,
        },
      },
      actions: {
        updateRaster: vi.fn(),
        updateParticles: vi.fn(),
        updatePressureContours: vi.fn(),
        toggleUnitSystem: vi.fn(),
      },
    }),
  }
})

function renderDisplayHook(options: {
  selectedLayerId?: 'temperature' | 'relative_humidity' | 'air_pressure' | 'precipitation_rate' | 'accumulated_precipitation' | 'cloud_layers' | 'wind_speed' | 'composite_reflectivity'
  unitSystem?: 'imperial' | 'metric'
} = {}) {
  mocks.unitSystem = options.unitSystem ?? 'imperial'
  const selectedLayerId = options.selectedLayerId ?? 'temperature'

  return renderHook(() => useForecastProbeValueFormatter(selectedLayerId))
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

    expect(result.current(0).text).toBe('0.00 in/hr')
    expect(result.current(0.25).text).toBe('0.01 in/hr')
    expect(result.current(0.75).text).toBe('0.03 in/hr')
    expect(result.current(2.54).text).toBe('0.10 in/hr')
    expect(result.current(7.62).text).toBe('0.30 in/hr')
  })

  it('formats metric precipitation values with two fixed decimal places', () => {
    const { result } = renderDisplayHook({
      selectedLayerId: 'precipitation_rate',
      unitSystem: 'metric',
    })

    expect(result.current(2.5).text).toBe('2.50 mm/hr')
  })

  it('formats accumulated precipitation probes', () => {
    const { result } = renderDisplayHook({ selectedLayerId: 'accumulated_precipitation' })

    expect(result.current(0).text).toBe('0 in')
    expect(result.current(2.54).text).toBe('0.1 in')
    expect(result.current(12.7).text).toBe('0.5 in')
    expect(result.current(25.4).text).toBe('1 in')
  })

  it('formats radar probes', () => {
    const { result } = renderDisplayHook({ selectedLayerId: 'composite_reflectivity' })

    expect(result.current(13).text).toBe('13 dBZ')
    expect(result.current(33).text).toBe('33 dBZ')
    expect(result.current(45).text).toBe('45 dBZ')
  })

  it('formats cloud-layer probes', () => {
    const { result } = renderDisplayHook({ selectedLayerId: 'cloud_layers' })

    expect(result.current(88).text).toBe('88 %')
    expect(result.current(41).text).toBe('41 %')
    expect(result.current(12).text).toBe('12 %')
  })

  it('formats wind probes', () => {
    const { result } = renderDisplayHook({ selectedLayerId: 'wind_speed' })

    expect(result.current(2).text).toBe('4 mph')
    expect(result.current(5).text).toBe('11 mph')
    expect(result.current(9).text).toBe('20 mph')
    expect(result.current(18).text).toBe('40 mph')
  })

  it('formats metric wind probes', () => {
    const { result } = renderDisplayHook({
      selectedLayerId: 'wind_speed',
      unitSystem: 'metric',
    })

    expect(result.current(9).text).toBe('32 km/h')
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
