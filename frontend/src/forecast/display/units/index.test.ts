import { describe, expect, it } from 'vitest'

import { FORECAST_DISPLAY_PROFILES } from '../profiles'
import {
  canToggleUnitSystem,
  formatUnitLegendValue,
  formatUnitValue,
  fromNative,
  getUnitOption,
  getUnitOptionForSystem,
  toNative,
} from './index'

describe('unit display helpers', () => {
  it('maps global unit systems to configured display units', () => {
    const temperature = FORECAST_DISPLAY_PROFILES.temperature.units
    const precipRate = FORECAST_DISPLAY_PROFILES['precipitation-rate'].units

    expect(canToggleUnitSystem(temperature)).toBe(true)
    expect(getUnitOption(temperature).id).toBe('fahrenheit')
    expect(getUnitOptionForSystem(temperature, 'metric').id).toBe('celsius')
    expect(getUnitOptionForSystem(precipRate, 'imperial').id).toBe('in_per_hour')
    expect(getUnitOptionForSystem(precipRate, 'metric').id).toBe('mm_per_hour')
  })

  it('converts display values to and from native values', () => {
    const temperature = FORECAST_DISPLAY_PROFILES.temperature.units
    const wind = FORECAST_DISPLAY_PROFILES['wind-speed'].units
    const snowDepth = FORECAST_DISPLAY_PROFILES['snow-depth'].units
    const visibility = FORECAST_DISPLAY_PROFILES.visibility.units
    const pressure = FORECAST_DISPLAY_PROFILES['air-pressure'].units

    expect(fromNative(10, getUnitOption(temperature, 'fahrenheit'))).toBe(50)
    expect(toNative(50, getUnitOption(temperature, 'fahrenheit'))).toBe(10)
    expect(fromNative(10, getUnitOption(wind, 'kilometers_per_hour'))).toBe(36)
    expect(toNative(36, getUnitOption(wind, 'kilometers_per_hour'))).toBe(10)
    expect(Math.round(fromNative(1, getUnitOption(snowDepth, 'inches')))).toBe(39)
    expect(toNative(120, getUnitOption(snowDepth, 'centimeters'))).toBe(1.2)
    expect(fromNative(1500, getUnitOption(visibility, 'kilometers'))).toBe(1.5)
    expect(toNative(1.5, getUnitOption(visibility, 'kilometers'))).toBe(1500)
    expect(fromNative(101_325, getUnitOption(pressure))).toBe(1013.25)
  })

  it('formats display values using unit-owned precision', () => {
    const precipRate = FORECAST_DISPLAY_PROFILES['precipitation-rate'].units
    const precipTotal = FORECAST_DISPLAY_PROFILES['accumulated-precipitation'].units
    const percent = FORECAST_DISPLAY_PROFILES['relative-humidity'].units
    const visibility = FORECAST_DISPLAY_PROFILES.visibility.units

    expect(formatUnitValue(0.1, getUnitOption(precipRate, 'in_per_hour'))).toBe('0.10')
    expect(formatUnitValue(2.5, getUnitOption(precipRate, 'mm_per_hour'))).toBe('2.50')
    expect(formatUnitValue(1.25, getUnitOption(precipTotal, 'inches'))).toBe('1.3')
    expect(formatUnitValue(55.25, getUnitOption(percent))).toBe('55')
    expect(formatUnitValue(3.106855961, getUnitOption(visibility, 'miles'))).toBe('3.1')
  })

  it('formats legend labels using unit-owned precision', () => {
    const precipRate = FORECAST_DISPLAY_PROFILES['precipitation-rate'].units
    const temperature = FORECAST_DISPLAY_PROFILES.temperature.units
    const percent = FORECAST_DISPLAY_PROFILES['relative-humidity'].units

    expect(formatUnitLegendValue(0, getUnitOption(precipRate, 'mm_per_hour'))).toBe('0')
    expect(formatUnitLegendValue(0.03, getUnitOption(precipRate, 'in_per_hour'))).toBe('0.03')
    expect(formatUnitLegendValue(2.5, getUnitOption(precipRate, 'mm_per_hour'))).toBe('2.5')
    expect(formatUnitLegendValue(15.2, getUnitOption(precipRate, 'mm_per_hour'))).toBe('15')
    expect(formatUnitLegendValue(50.4, getUnitOption(temperature, 'fahrenheit'))).toBe('50')
    expect(formatUnitLegendValue(55.25, getUnitOption(percent))).toBe('55')
    expect(formatUnitLegendValue(9.25, {})).toBe('9.3')
    expect(formatUnitLegendValue(10.25, {})).toBe('10')
  })
})
