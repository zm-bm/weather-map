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
    label: 'Precipitation Rate',
    units,
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

  it('uses whole-number formatting for percentage values', () => {
    const display = getUnitDisplay({
      id: 'rh_surface',
      label: 'Relative Humidity',
      units: '%',
      min: 0,
      max: 100,
      colortable: [],
    })

    expect(formatUnitValue(55.25, getUnitOption(display))).toBe('55')
  })
})
