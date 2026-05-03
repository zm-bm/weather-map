import { describe, expect, it } from 'vitest'

import type { ScalarMeta } from '../forecast-metadata/scalar'
import {
  canToggleUnitSystem,
  formatUnitValue,
  getUnitDisplay,
  getUnitOption,
  getUnitOptionForSystem,
} from './index'

function createPrecipMeta(units: string): ScalarMeta {
  return {
    id: 'prate_surface',
    label: 'prate_surface',
    units,
    parameter: 'prate',
    min: 0,
    max: 30,
    colortable: [],
  }
}

describe('getUnitDisplay', () => {
  it('uses mm/hr precipitation values directly when ETL already converted them', () => {
    const display = getUnitDisplay(createPrecipMeta('mm/hr'))

    expect(getUnitOption(display, 'mm_per_hour').convert(12)).toBe(12)
    expect(getUnitOption(display, 'in_per_hour').convert(25.4)).toBe(1)
  })

  it('maps global unit systems to precipitation display units', () => {
    const display = getUnitDisplay(createPrecipMeta('mm/hr'))

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOption(display).id).toBe('in_per_hour')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('in_per_hour')
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('mm_per_hour')
  })

  it('uses fixed two-decimal formatting for precipitation display values', () => {
    const display = getUnitDisplay(createPrecipMeta('mm/hr'))

    expect(formatUnitValue(0.1, getUnitOption(display, 'in_per_hour'))).toBe('0.10')
    expect(formatUnitValue(2.5, getUnitOption(display, 'mm_per_hour'))).toBe('2.50')
  })

  it('maps accumulated precipitation from millimeters to inches', () => {
    const display = getUnitDisplay({
      id: 'precip_total_surface',
      label: 'precip_total_surface',
      units: 'mm',
      parameter: 'precip_total',
      min: 0,
      max: 254,
      colortable: [],
    })

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('millimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'inches').convert(25.4)).toBe(1)
    expect(formatUnitValue(1.25, getUnitOption(display, 'inches'))).toBe('1.3')
  })

  it('uses whole-number formatting for percentage values', () => {
    const display = getUnitDisplay({
      id: 'rh_surface',
      label: 'rh_surface',
      units: '%',
      parameter: 'rh',
      min: 0,
      max: 100,
      colortable: [],
    })

    expect(formatUnitValue(55.25, getUnitOption(display))).toBe('55')
  })

  it('treats dew point as a temperature unit', () => {
    const display = getUnitDisplay({
      id: 'dewpoint_surface',
      label: 'dewpoint_surface',
      units: 'C',
      parameter: 'dpt',
      min: -60,
      max: 40,
      colortable: [],
    })

    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('fahrenheit')
    expect(getUnitOption(display, 'fahrenheit').convert(10)).toBe(50)
  })

  it('maps wind gust from meters per second to speed display units', () => {
    const display = getUnitDisplay({
      id: 'gust_surface',
      label: 'gust_surface',
      units: 'm/s',
      parameter: 'gust',
      min: 0,
      max: 60,
      colortable: [],
    })

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('kilometers_per_hour')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('miles_per_hour')
    expect(getUnitOption(display, 'kilometers_per_hour').convert(10)).toBe(36)
  })

  it('matches raw manifest product labels through parameter metadata', () => {
    const temperature = getUnitDisplay({
      id: 'tmp_surface',
      label: 'tmp_surface',
      units: 'C',
      parameter: 'tmp',
      min: -35,
      max: 50,
      colortable: [],
    })
    const pressure = getUnitDisplay({
      id: 'prmsl_surface',
      label: 'prmsl_surface',
      units: 'Pa',
      parameter: 'prmsl',
      min: 98000,
      max: 103500,
      colortable: [],
    })

    expect(getUnitOptionForSystem(temperature, 'imperial').id).toBe('fahrenheit')
    expect(getUnitOption(pressure).id).toBe('hectopascal')
    expect(getUnitOption(pressure).convert(101_325)).toBe(1013.25)
  })
})
