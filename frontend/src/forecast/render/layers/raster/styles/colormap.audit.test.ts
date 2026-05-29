import { describe, expect, it } from 'vitest'

import { FORECAST_RASTER_LAYERS } from '@/forecast/catalog'
import {
  getRasterPalette,
  normalizePaletteColor,
  samplePaletteColor,
  type RasterPaletteDefinition,
  type PaletteColorStop,
  type PaletteSamplingMode,
  type SampledPaletteColor,
} from '@/forecast/palette'
import type { ForecastRasterLayer } from '@/forecast/catalog'
import { buildColormapLut } from './colormap'
import { COLORMAP_FRAGMENT_SHADER_SOURCE } from './colormapShaders'

const SAMPLING_MODES = ['banded', 'interpolated'] as const satisfies readonly PaletteSamplingMode[]

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getLutRgba(lut: Uint8Array, index: number): SampledPaletteColor {
  const offset = index * 4
  return [lut[offset], lut[offset + 1], lut[offset + 2], lut[offset + 3]]
}

function renderedColor(
  layer: ForecastRasterLayer,
  palette: RasterPaletteDefinition,
  value: number,
  samplingMode: PaletteSamplingMode,
): SampledPaletteColor {
  const clampedValue = clampValue(value, layer.display.range.min, layer.display.range.max)
  return samplePaletteColor(palette.stops, clampedValue, samplingMode)
}

function expectedThresholdColor(
  layer: ForecastRasterLayer,
  palette: RasterPaletteDefinition,
  value: number,
): SampledPaletteColor {
  const clampedValue = clampValue(value, layer.display.range.min, layer.display.range.max)
  let selected = palette.stops[0]!
  for (const stop of palette.stops.slice(1)) {
    if (clampedValue < stop.value) break
    selected = stop
  }
  return normalizePaletteColor(selected.color)
}

function expectedInterpolatedColor(
  layer: ForecastRasterLayer,
  palette: RasterPaletteDefinition,
  value: number,
): SampledPaletteColor {
  const clampedValue = clampValue(value, layer.display.range.min, layer.display.range.max)
  const first = palette.stops[0]!
  if (clampedValue <= first.value) return normalizePaletteColor(first.color)

  const last = palette.stops[palette.stops.length - 1]!
  if (clampedValue >= last.value) return normalizePaletteColor(last.color)

  for (let index = 0; index < palette.stops.length - 1; index += 1) {
    const lowerStop = palette.stops[index]!
    const upperStop = palette.stops[index + 1]!
    if (clampedValue < lowerStop.value || clampedValue > upperStop.value) continue

    const lowerColor = normalizePaletteColor(lowerStop.color)
    const upperColor = normalizePaletteColor(upperStop.color)
    const span = Math.max(1e-6, upperStop.value - lowerStop.value)
    const t = (clampedValue - lowerStop.value) / span

    return [
      Math.round(lowerColor[0] + (upperColor[0] - lowerColor[0]) * t),
      Math.round(lowerColor[1] + (upperColor[1] - lowerColor[1]) * t),
      Math.round(lowerColor[2] + (upperColor[2] - lowerColor[2]) * t),
      Math.round(lowerColor[3] + (upperColor[3] - lowerColor[3]) * t),
    ]
  }

  return normalizePaletteColor(last.color)
}

function expectedColor(
  layer: ForecastRasterLayer,
  palette: RasterPaletteDefinition,
  value: number,
  samplingMode: PaletteSamplingMode,
): SampledPaletteColor {
  return samplingMode === 'banded'
    ? expectedThresholdColor(layer, palette, value)
    : expectedInterpolatedColor(layer, palette, value)
}

function boundaryDelta(
  layer: ForecastRasterLayer,
  stops: readonly PaletteColorStop[],
  index: number,
): number {
  const stop = stops[index]!
  const lowerGap = index > 0 ? stop.value - stops[index - 1]!.value : Number.POSITIVE_INFINITY
  const upperGap = index < stops.length - 1 ? stops[index + 1]!.value - stop.value : Number.POSITIVE_INFINITY
  const displayRange = layer.display.range.max - layer.display.range.min
  const smallestUsefulGap = Math.min(
    ...[lowerGap, upperGap, displayRange]
      .filter((gap) => Number.isFinite(gap) && gap > 0)
  )
  return Math.max(smallestUsefulGap * 1e-4, 1e-9)
}

describe('production raster palette contracts', () => {
  for (const layer of FORECAST_RASTER_LAYERS) {
    const palette = getRasterPalette(primaryPaletteId(layer))

    it(`${layer.id} clamps display range and preserves color-stop boundaries`, () => {
      expect(palette.outOfRange).toBe('clamp')
      expect(palette.boundaryMode).toBe('lower-bound-inclusive')

      const displaySpan = layer.display.range.max - layer.display.range.min
      const outsideDelta = Math.max(displaySpan * 0.01, 1)

      for (const samplingMode of SAMPLING_MODES) {
        expect(renderedColor(layer, palette, layer.display.range.min - outsideDelta, samplingMode))
          .toEqual(expectedColor(layer, palette, layer.display.range.min, samplingMode))
        expect(renderedColor(layer, palette, layer.display.range.max + outsideDelta, samplingMode))
          .toEqual(expectedColor(layer, palette, layer.display.range.max, samplingMode))

        for (const [index, stop] of palette.stops.entries()) {
          if (stop.value < layer.display.range.min || stop.value > layer.display.range.max) continue

          const delta = boundaryDelta(layer, palette.stops, index)
          expect(renderedColor(layer, palette, stop.value - delta, samplingMode))
            .toEqual(expectedColor(layer, palette, stop.value - delta, samplingMode))
          expect(renderedColor(layer, palette, stop.value, samplingMode))
            .toEqual(normalizePaletteColor(stop.color))
          expect(renderedColor(layer, palette, stop.value + delta, samplingMode))
            .toEqual(expectedColor(layer, palette, stop.value + delta, samplingMode))
        }
      }
    })
  }

  it('builds LUT endpoints from the same production palette contract', () => {
    for (const layer of FORECAST_RASTER_LAYERS) {
      const palette = getRasterPalette(primaryPaletteId(layer))
      const displayRange = layer.display.range

      for (const samplingMode of SAMPLING_MODES) {
        const lut = buildColormapLut(palette.stops, displayRange, 16, samplingMode)
        expect(getLutRgba(lut, 0)).toEqual(renderedColor(layer, palette, layer.display.range.min, samplingMode))
        expect(getLutRgba(lut, 15)).toEqual(renderedColor(layer, palette, layer.display.range.max, samplingMode))
      }
    }
  })

  it('keeps exact zero snow depth transparent and positive snow visible', () => {
    const layer = FORECAST_RASTER_LAYERS.find((candidate) => candidate.id === 'snow_depth')
    expect(layer).toBeDefined()
    const palette = getRasterPalette(primaryPaletteId(layer!))

    expect(renderedColor(layer!, palette, 0, 'banded')[3]).toBe(0)
    expect(renderedColor(layer!, palette, 0.02, 'banded')[3]).toBe(255)
  })

  it('keeps nodata transparent in the colormap raster shader', () => {
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('encodedIsMissing(stored, hasNodata, nodata)')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('return encodedMissing();')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('if (sampleValue.valid <= 0.0)')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('outColor = vec4(0.0);')
  })
})

function primaryPaletteId(layer: typeof FORECAST_RASTER_LAYERS[number]): string {
  return layer.source.bands[0].paletteId
}
