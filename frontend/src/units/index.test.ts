import { describe, expect, it } from 'vitest'

import type { LayerMeta } from '../forecast-catalog'
import {
  canToggleUnitSystem,
  formatUnitValue,
  getUnitDisplay,
  getUnitOption,
  getUnitOptionForSystem,
} from './index'

function createLayerMeta(overrides: Partial<LayerMeta> & Pick<LayerMeta, 'unitBehavior'>): LayerMeta {
  return {
    id: 'test_layer',
    label: 'Test Layer',
    units: '',
    parameter: 'test',
    min: 0,
    max: 1,
    paletteId: 'test.palette.v1',
    legendScale: 'stop-based',
    colortable: [],
    ...overrides,
  }
}

function createPrecipMeta(units: string): LayerMeta {
  return createLayerMeta({
    id: 'precipitation_rate',
    label: 'Precipitation Rate',
    units,
    parameter: 'prate',
    min: 0,
    max: 30,
    paletteId: 'precip.rate.mm_hr.v1',
    unitBehavior: 'precip-rate',
    legendScale: 'precip-rate',
  })
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
    const display = getUnitDisplay(createLayerMeta({
      id: 'accumulated_precipitation',
      label: 'Accumulated Precipitation',
      units: 'mm',
      parameter: 'precip_total',
      min: 0,
      max: 254,
      paletteId: 'precip.total.mm.v1',
      unitBehavior: 'precip-total',
      legendScale: 'precip-total',
    }))

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('millimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'inches').convert(25.4)).toBe(1)
    expect(formatUnitValue(1.25, getUnitOption(display, 'inches'))).toBe('1.3')
  })

  it('maps snow depth from meters to centimeters and inches', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'snow_depth',
      label: 'Snow Depth',
      units: 'm',
      parameter: 'snow_depth',
      min: 0,
      max: 5,
      paletteId: 'snow.depth.m.v1',
      unitBehavior: 'snow-depth',
    }))

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('centimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'centimeters').convert(1.2)).toBe(120)
    expect(Math.round(getUnitOption(display, 'inches').convert(1))).toBe(39)
  })

  it('maps visibility from meters to kilometers and miles', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'visibility',
      label: 'Visibility',
      units: 'm',
      parameter: 'visibility',
      min: 0,
      max: 50000,
      paletteId: 'atmosphere.visibility.m.v1',
      unitBehavior: 'visibility',
    }))

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('kilometers')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('miles')
    expect(getUnitOption(display, 'kilometers').convert(1500)).toBe(1.5)
    expect(formatUnitValue(3.106855961, getUnitOption(display, 'miles'))).toBe('3.1')
  })

  it('maps freezing level from meters to feet', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'freezing_level',
      label: 'Freezing Level',
      units: 'm',
      parameter: 'freezing_level',
      min: 0,
      max: 8000,
      paletteId: 'atmosphere.freezing_level.m.v1',
      unitBehavior: 'height',
    }))

    expect(getUnitOptionForSystem(display, 'metric').id).toBe('meters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('feet')
    expect(Math.round(getUnitOption(display, 'feet').convert(1000))).toBe(3281)
  })

  it('maps precipitable water from millimeters to inches', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'precipitable_water',
      label: 'Precipitable Water',
      units: 'mm',
      parameter: 'precipitable_water',
      min: 0,
      max: 80,
      paletteId: 'atmosphere.precipitable_water.mm.v1',
      unitBehavior: 'water-depth',
    }))

    expect(getUnitOptionForSystem(display, 'metric').id).toBe('millimeters')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('inches')
    expect(getUnitOption(display, 'inches').convert(25.4)).toBe(1)
  })

  it('keeps CAPE as a static J/kg display', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'cape',
      label: 'CAPE Index',
      units: 'J/kg',
      parameter: 'cape',
      min: 0,
      max: 5000,
      paletteId: 'severe.cape.jkg.v1',
      unitBehavior: 'cape',
    }))

    expect(canToggleUnitSystem(display)).toBe(false)
    expect(getUnitOption(display).id).toBe('joules_per_kilogram')
    expect(formatUnitValue(1250.4, getUnitOption(display))).toBe('1250')
  })

  it('uses whole-number formatting for percentage values', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'relative_humidity',
      label: 'Relative Humidity',
      units: '%',
      parameter: 'rh',
      min: 0,
      max: 100,
      paletteId: 'moisture.relative_humidity.percent.v1',
      unitBehavior: 'percent',
      legendScale: 'percent',
    }))

    expect(formatUnitValue(55.25, getUnitOption(display))).toBe('55')
  })

  it('treats dew point as a temperature unit', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'dew_point',
      label: 'Dew Point',
      units: 'C',
      parameter: 'dpt',
      min: -60,
      max: 40,
      paletteId: 'temperature.dewpoint.c.v1',
      unitBehavior: 'temperature',
      legendScale: 'temperature',
    }))

    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('fahrenheit')
    expect(getUnitOption(display, 'fahrenheit').convert(10)).toBe(50)
  })

  it('maps wind gust from meters per second to speed display units', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'wind_gust',
      label: 'Wind Gust',
      units: 'm/s',
      parameter: 'gust',
      min: 0,
      max: 60,
      paletteId: 'wind.gust.mps.v1',
      unitBehavior: 'wind-speed',
    }))

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('kilometers_per_hour')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('miles_per_hour')
    expect(getUnitOption(display, 'kilometers_per_hour').convert(10)).toBe(36)
  })

  it('maps derived wind speed from meters per second to speed display units', () => {
    const display = getUnitDisplay(createLayerMeta({
      id: 'wind_speed',
      label: 'Wind Speed',
      units: 'm/s',
      parameter: 'wind_speed',
      min: 0,
      max: 60,
      paletteId: 'wind.gust.mps.v1',
      unitBehavior: 'wind-speed',
    }))

    expect(canToggleUnitSystem(display)).toBe(true)
    expect(getUnitOptionForSystem(display, 'metric').id).toBe('kilometers_per_hour')
    expect(getUnitOptionForSystem(display, 'imperial').id).toBe('miles_per_hour')
  })

  it('uses explicit catalog unit behavior instead of label or parameter heuristics', () => {
    const temperature = getUnitDisplay(createLayerMeta({
      id: 'temperature',
      label: 'Temperature',
      units: 'C',
      parameter: 'tmp',
      min: -35,
      max: 50,
      paletteId: 'temperature.air.c.v1',
      unitBehavior: 'temperature',
      legendScale: 'temperature',
    }))
    const pressure = getUnitDisplay(createLayerMeta({
      id: 'air_pressure',
      label: 'Air Pressure',
      units: 'Pa',
      parameter: 'prmsl',
      min: 98000,
      max: 103500,
      paletteId: 'pressure.msl.pa.v1',
      unitBehavior: 'pressure',
      legendScale: 'pressure',
    }))

    expect(getUnitOptionForSystem(temperature, 'imperial').id).toBe('fahrenheit')
    expect(getUnitOption(pressure).id).toBe('hectopascal')
    expect(getUnitOption(pressure).convert(101_325)).toBe(1013.25)
  })
})
