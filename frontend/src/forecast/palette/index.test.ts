import { describe, expect, it } from 'vitest'

import { FIELD_PALETTES, getLayerPalette, samplePaletteColor } from './index'
import { parseForecastPalettes } from './schema'

const VALID_PALETTE = {
  id: 'test.palette.v1',
  label: 'Test Palette',
  valueUnit: 'unit',
  outOfRange: 'clamp',
  boundaryMode: 'lower-bound-inclusive',
  stops: [
    { value: 0, color: [1, 2, 3] },
    { value: 1, color: [4, 5, 6, 128] },
  ],
}

describe('forecast palettes', () => {
  it('validates and resolves known built-in layer palettes', () => {
    expect(FIELD_PALETTES.length).toBeGreaterThan(0)
    expect(getLayerPalette('temperature.air.c.v1').stops.length).toBeGreaterThan(0)
    expect(getLayerPalette('pressure.msl.pa.v1').stops[0]).toEqual({
      value: 98000,
      color: [70, 155, 225],
    })
  })

  it('rejects unknown palette ids', () => {
    expect(() => getLayerPalette('missing.palette.v1')).toThrow('Unknown layer paletteId: missing.palette.v1')
  })

  it('rejects invalid palette contracts', () => {
    expect(() => parseForecastPalettes([
      VALID_PALETTE,
      { ...VALID_PALETTE },
    ])).toThrow(/duplicate palette id test\.palette\.v1/)

    expect(() => parseForecastPalettes([
      { ...VALID_PALETTE, stops: [] },
    ])).toThrow()

    expect(() => parseForecastPalettes([
      {
        ...VALID_PALETTE,
        stops: [
          { value: 1, color: [1, 2, 3] },
          { value: 1, color: [4, 5, 6] },
        ],
      },
    ])).toThrow(/stop values must be strictly increasing/)

    expect(() => parseForecastPalettes([
      {
        ...VALID_PALETTE,
        stops: [
          { value: 0, color: [1, 2, 3] },
          { value: Number.NaN, color: [4, 5, 6] },
        ],
      },
    ])).toThrow()

    expect(() => parseForecastPalettes([
      {
        ...VALID_PALETTE,
        stops: [
          { value: 0, color: [1, 2, 3] },
          { value: 1, color: [4, 5, 256] },
        ],
      },
    ])).toThrow()

    expect(() => parseForecastPalettes([
      { ...VALID_PALETTE, outOfRange: 'extend' },
    ])).toThrow()

    expect(() => parseForecastPalettes([
      { ...VALID_PALETTE, boundaryMode: 'nearest' },
    ])).toThrow()
  })

  it('samples object stops using lower-bound and interpolated semantics', () => {
    const stops = [
      { value: 0, color: [0, 0, 0] },
      { value: 10, color: [100, 100, 100, 128] },
    ] as const

    expect(samplePaletteColor(stops, -1, 'banded')).toEqual([0, 0, 0, 255])
    expect(samplePaletteColor(stops, 10, 'banded')).toEqual([100, 100, 100, 128])
    expect(samplePaletteColor(stops, 5, 'interpolated')).toEqual([50, 50, 50, 192])
    expect(samplePaletteColor(stops, 11, 'interpolated')).toEqual([100, 100, 100, 128])
  })
})
