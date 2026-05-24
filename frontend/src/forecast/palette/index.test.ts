import { describe, expect, it } from 'vitest'

import { getLayerPalette } from './index'

describe('forecast palettes', () => {
  it('resolves known layer palettes', () => {
    expect(getLayerPalette('temperature.air.c.v1').colorStops.length).toBeGreaterThan(0)
    expect(getLayerPalette('pressure.msl.pa.v1').colorStops[0]).toEqual([98000, 70, 155, 225])
  })

  it('rejects unknown palette ids', () => {
    expect(() => getLayerPalette('missing.palette.v1')).toThrow('Unknown layer paletteId: missing.palette.v1')
  })
})
