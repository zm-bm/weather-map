import { describe, expect, it } from 'vitest'

import {
  assertUnitBehavior,
  canToggleUnitSystem,
  formatUnitValue,
  getUnitDisplay,
  getUnitOption,
  getUnitOptionForSystem,
  isUnitBehavior,
} from './index'

describe('unit behavior', () => {
  it('validates known unit behaviors', () => {
    expect(isUnitBehavior('temperature')).toBe(true)
    expect(assertUnitBehavior('temperature')).toBe('temperature')
    expect(isUnitBehavior('bogus')).toBe(false)
    expect(() => assertUnitBehavior('bogus')).toThrow('Unknown unit behavior: bogus')
  })
})

describe('getUnitDisplay', () => {
  it('uses mm/hr precipitation values directly when ETL already converted them', () => {
    const display = getUnitDisplay('precip-rate')

    expect(getUnitOption(display, 'mm_per_hour').convert(12)).toBe(12)
    expect(getUnitOption(display, 'in_per_hour').convert(25.4)).toBe(1)
  })

  it('maps global unit systems to precipitation display units', () => {
    const display = getUnitDisplay('precip-rate')

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOption(display).id).toBe('in_per_hour')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('in_per_hour')
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('mm_per_hour')
  })

  it('uses fixed two-decimal formatting for precipitation display values', () => {
    const display = getUnitDisplay('precip-rate')

    expect(formatUnitValue(0.1, getUnitOption(display, 'in_per_hour'))).toBe('0.10')
    expect(formatUnitValue(2.5, getUnitOption(display, 'mm_per_hour'))).toBe('2.50')
  })

  it('maps accumulated precipitation from millimeters to inches', () => {
    const display = getUnitDisplay('precip-total')

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('millimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'inches').convert(25.4)).toBe(1)
    expect(formatUnitValue(1.25, getUnitOption(display, 'inches'))).toBe('1.3')
  })

  it('maps snow depth from meters to centimeters and inches', () => {
    const display = getUnitDisplay('snow-depth')

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('centimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'centimeters').convert(1.2)).toBe(120)
    expect(Math.round(getUnitOption(display, 'inches').convert(1))).toBe(39)
  })

  it('maps visibility from meters to kilometers and miles', () => {
    const display = getUnitDisplay('visibility')

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('kilometers')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('miles')
    expect(getUnitOption(display, 'kilometers').convert(1500)).toBe(1.5)
    expect(formatUnitValue(3.106855961, getUnitOption(display, 'miles'))).toBe('3.1')
  })

  it('maps freezing level from meters to feet', () => {
    const display = getUnitDisplay('height')

    expect(getUnitOptionForSystem(display, 'metric').id).toBe('meters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('feet')
    expect(Math.round(getUnitOption(display, 'feet').convert(1000))).toBe(3281)
  })

  it('maps precipitable water from millimeters to inches', () => {
    const display = getUnitDisplay('water-depth')

    expect(getUnitOptionForSystem(display, 'metric').id).toBe('millimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'inches').convert(25.4)).toBe(1)
  })

  it('keeps energy per mass as a static J/kg display', () => {
    const display = getUnitDisplay('energy-per-mass')

    expect(canToggleUnitSystem(display)).toBe(false)
    expect(getUnitOption(display).id).toBe('joules_per_kilogram')
    expect(formatUnitValue(1250.4, getUnitOption(display))).toBe('1250')
  })

  it('keeps reflectivity as a static dBZ display', () => {
    const display = getUnitDisplay('reflectivity')

    expect(canToggleUnitSystem(display)).toBe(false)
    expect(getUnitOption(display).id).toBe('dbz')
    expect(formatUnitValue(42.4, getUnitOption(display))).toBe('42')
  })

  it('uses whole-number formatting for percentage values', () => {
    const display = getUnitDisplay('percent')

    expect(formatUnitValue(55.25, getUnitOption(display))).toBe('55')
  })

  it('treats dew point as a temperature unit', () => {
    const display = getUnitDisplay('temperature')

    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('fahrenheit')
    expect(getUnitOption(display, 'fahrenheit').convert(10)).toBe(50)
  })

  it('maps wind from meters per second to speed display units', () => {
    const display = getUnitDisplay('wind-speed')

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('kilometers_per_hour')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('miles_per_hour')
    expect(getUnitOption(display, 'kilometers_per_hour').convert(10)).toBe(36)
  })

  it('uses explicit unit behavior instead of label or parameter heuristics', () => {
    const temperature = getUnitDisplay('temperature')
    const pressure = getUnitDisplay('pressure')

    expect(getUnitOptionForSystem(temperature, 'imperial').id).toBe('fahrenheit')
    expect(getUnitOption(pressure).id).toBe('hectopascal')
    expect(getUnitOption(pressure).convert(101_325)).toBe(1013.25)
  })
})
