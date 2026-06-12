import { describe, expect, it } from 'vitest'

import {
  AIR_TEMPERATURE_PALETTE,
  CAPE_PALETTE,
  CIN_PALETTE,
  CLOUD_COMPOSITE_PALETTE,
  CLOUD_COVER_PALETTE,
  CLOUD_HIGH_PALETTE,
  CLOUD_LOW_PALETTE,
  CLOUD_MIDDLE_PALETTE,
  DEW_POINT_PALETTE,
  FREEZING_LEVEL_PALETTE,
  PRECIPITABLE_WATER_PALETTE,
  PRECIP_RATE_PALETTE,
  PRECIP_TOTAL_PALETTE,
  PRESSURE_PALETTE,
  REFLECTIVITY_PALETTE,
  RELATIVE_HUMIDITY_PALETTE,
  SNOW_DEPTH_PALETTE,
  VISIBILITY_PALETTE,
  WIND_SPEED_PALETTE,
  samplePaletteColor,
} from './index'
import { parseForecastPalettes } from './schema'

const VALID_PALETTE = {
  id: 'test.palette.v1',
  stops: [
    { value: 0, color: [1, 2, 3] },
    { value: 1, color: [4, 5, 6, 128] },
  ],
}

const BUILT_IN_PALETTE_FIXTURES = [
  AIR_TEMPERATURE_PALETTE,
  RELATIVE_HUMIDITY_PALETTE,
  WIND_SPEED_PALETTE,
  DEW_POINT_PALETTE,
  CLOUD_COVER_PALETTE,
  CLOUD_LOW_PALETTE,
  CLOUD_MIDDLE_PALETTE,
  CLOUD_HIGH_PALETTE,
  CLOUD_COMPOSITE_PALETTE,
  PRESSURE_PALETTE,
  PRECIP_RATE_PALETTE,
  PRECIP_TOTAL_PALETTE,
  SNOW_DEPTH_PALETTE,
  VISIBILITY_PALETTE,
  FREEZING_LEVEL_PALETTE,
  PRECIPITABLE_WATER_PALETTE,
  CAPE_PALETTE,
  CIN_PALETTE,
  REFLECTIVITY_PALETTE,
]

describe('forecast palettes', () => {
  it('validates and resolves known built-in raster palettes', () => {
    expect(parseForecastPalettes(BUILT_IN_PALETTE_FIXTURES).length).toBeGreaterThan(0)
    expect(AIR_TEMPERATURE_PALETTE.stops.length).toBeGreaterThan(0)
    expect(PRESSURE_PALETTE.stops[0]).toEqual({
      value: 98000,
      color: [70, 155, 225],
    })
  })

  it('uses one humidity color ramp with layer-specific stop values', () => {
    expect(RELATIVE_HUMIDITY_PALETTE.stops.map((stop) => stop.color))
      .toEqual(DEW_POINT_PALETTE.stops.map((stop) => stop.color))
    expect(RELATIVE_HUMIDITY_PALETTE.stops.map((stop) => stop.value))
      .toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(DEW_POINT_PALETTE.stops.map((stop) => stop.value))
      .toEqual([-30, -22, -15, -8, 0, 8, 12, 16, 20, 24, 30])
  })

  it('defines the shared reflectivity palette from the reference legend stops', () => {
    expect(REFLECTIVITY_PALETTE.id).toBe('radar.reflectivity.dbz.v2')
    expect(REFLECTIVITY_PALETTE.stops).toEqual([
      { value: -35, color: [204, 255, 255] },
      { value: -25, color: [204, 153, 204] },
      { value: -15, color: [153, 102, 153] },
      { value: -5, color: [153, 153, 102] },
      { value: 5, color: [0, 235, 235] },
      { value: 15, color: [0, 0, 247] },
      { value: 25, color: [0, 199, 0] },
      { value: 35, color: [255, 255, 0] },
      { value: 45, color: [255, 143, 0] },
      { value: 55, color: [215, 0, 0] },
      { value: 65, color: [255, 0, 255] },
      { value: 75, color: [155, 87, 203] },
    ])
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
      { ...VALID_PALETTE, outOfRange: 'clamp' },
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
