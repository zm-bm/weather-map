import { describe, expect, it } from 'vitest'

import type { ScalarMeta } from '../forecast-metadata/scalar'
import { getUnitDisplay, getUnitOption } from './index'

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

})
