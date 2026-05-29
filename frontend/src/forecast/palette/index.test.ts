import { describe, expect, it } from 'vitest'

import { RASTER_PALETTES, getRasterPalette, samplePaletteColor } from './index'
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
  it('validates and resolves known built-in raster palettes', () => {
    expect(RASTER_PALETTES.length).toBeGreaterThan(0)
    expect(getRasterPalette('temperature.air.c.v1').stops.length).toBeGreaterThan(0)
    expect(getRasterPalette('pressure.msl.pa.v1').stops[0]).toEqual({
      value: 98000,
      color: [70, 155, 225],
    })
  })

  it('uses one humidity color ramp with layer-specific stop values', () => {
    const relativeHumidity = getRasterPalette('moisture.relative_humidity.percent.v1')
    const dewPoint = getRasterPalette('temperature.dewpoint.c.v1')

    expect(relativeHumidity.stops.map((stop) => stop.color))
      .toEqual(dewPoint.stops.map((stop) => stop.color))
    expect(relativeHumidity.stops.map((stop) => stop.value))
      .toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(dewPoint.stops.map((stop) => stop.value))
      .toEqual([-30, -25, -20, -15, -10, 0, 5, 10, 15, 20, 30])
  })

  it('rejects unknown palette ids', () => {
    expect(() => getRasterPalette('missing.palette.v1')).toThrow('Unknown raster paletteId: missing.palette.v1')
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
