import { describe, expect, it } from 'vitest'

import { FORECAST_LAYERS } from '@/forecast/catalog'
import {
  getLayerPalette,
  normalizePaletteColor,
  samplePaletteColor,
  type FieldPaletteDefinition,
  type PaletteColorStop,
  type PaletteSamplingMode,
  type SampledPaletteColor,
} from '@/forecast/palette'
import type { LayerSpec } from '@/forecast/catalog'
import { buildColormapLut } from '@/forecast/render/field/engine/colormap'
import { SCALAR_FRAGMENT_SHADER_SOURCE } from '@/forecast/render/field/engine/shaders'

const SAMPLING_MODES = ['banded', 'interpolated'] as const satisfies readonly PaletteSamplingMode[]

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getLutRgba(lut: Uint8Array, index: number): SampledPaletteColor {
  const offset = index * 4
  return [lut[offset], lut[offset + 1], lut[offset + 2], lut[offset + 3]]
}

function renderedColor(
  layer: LayerSpec,
  palette: FieldPaletteDefinition,
  value: number,
  samplingMode: PaletteSamplingMode,
): SampledPaletteColor {
  const clampedValue = clampValue(value, layer.displayRange.min, layer.displayRange.max)
  return samplePaletteColor(palette.stops, clampedValue, samplingMode)
}

function expectedThresholdColor(
  layer: LayerSpec,
  palette: FieldPaletteDefinition,
  value: number,
): SampledPaletteColor {
  const clampedValue = clampValue(value, layer.displayRange.min, layer.displayRange.max)
  let selected = palette.stops[0]!
  for (const stop of palette.stops.slice(1)) {
    if (clampedValue < stop.value) break
    selected = stop
  }
  return normalizePaletteColor(selected.color)
}

function expectedInterpolatedColor(
  layer: LayerSpec,
  palette: FieldPaletteDefinition,
  value: number,
): SampledPaletteColor {
  const clampedValue = clampValue(value, layer.displayRange.min, layer.displayRange.max)
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
  layer: LayerSpec,
  palette: FieldPaletteDefinition,
  value: number,
  samplingMode: PaletteSamplingMode,
): SampledPaletteColor {
  return samplingMode === 'banded'
    ? expectedThresholdColor(layer, palette, value)
    : expectedInterpolatedColor(layer, palette, value)
}

function boundaryDelta(
  layer: LayerSpec,
  stops: readonly PaletteColorStop[],
  index: number,
): number {
  const stop = stops[index]!
  const lowerGap = index > 0 ? stop.value - stops[index - 1]!.value : Number.POSITIVE_INFINITY
  const upperGap = index < stops.length - 1 ? stops[index + 1]!.value - stop.value : Number.POSITIVE_INFINITY
  const displayRange = layer.displayRange.max - layer.displayRange.min
  const smallestUsefulGap = Math.min(
    ...[lowerGap, upperGap, displayRange]
      .filter((gap) => Number.isFinite(gap) && gap > 0)
  )
  return Math.max(smallestUsefulGap * 1e-4, 1e-9)
}

describe('production field palette contracts', () => {
  for (const layer of FORECAST_LAYERS) {
    const palette = getLayerPalette(layer.paletteId)

    it(`${layer.id} clamps display range and preserves color-stop boundaries`, () => {
      expect(palette.outOfRange).toBe('clamp')
      expect(palette.boundaryMode).toBe('lower-bound-inclusive')

      const displaySpan = layer.displayRange.max - layer.displayRange.min
      const outsideDelta = Math.max(displaySpan * 0.01, 1)

      for (const samplingMode of SAMPLING_MODES) {
        expect(renderedColor(layer, palette, layer.displayRange.min - outsideDelta, samplingMode))
          .toEqual(expectedColor(layer, palette, layer.displayRange.min, samplingMode))
        expect(renderedColor(layer, palette, layer.displayRange.max + outsideDelta, samplingMode))
          .toEqual(expectedColor(layer, palette, layer.displayRange.max, samplingMode))

        for (const [index, stop] of palette.stops.entries()) {
          if (stop.value < layer.displayRange.min || stop.value > layer.displayRange.max) continue

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
    for (const layer of FORECAST_LAYERS) {
      const palette = getLayerPalette(layer.paletteId)
      const displayRange = [layer.displayRange.min, layer.displayRange.max] as [number, number]

      for (const samplingMode of SAMPLING_MODES) {
        const lut = buildColormapLut(palette.stops, displayRange, 16, samplingMode)
        expect(getLutRgba(lut, 0)).toEqual(renderedColor(layer, palette, layer.displayRange.min, samplingMode))
        expect(getLutRgba(lut, 15)).toEqual(renderedColor(layer, palette, layer.displayRange.max, samplingMode))
      }
    }
  })

  it('keeps exact zero snow depth transparent and positive snow visible', () => {
    const layer = FORECAST_LAYERS.find((candidate) => candidate.id === 'snow_depth')
    expect(layer).toBeDefined()
    const palette = getLayerPalette(layer!.paletteId)

    expect(renderedColor(layer!, palette, 0, 'banded')[3]).toBe(0)
    expect(renderedColor(layer!, palette, 0.02, 'banded')[3]).toBe(255)
  })

  it('keeps nodata transparent in the scalar field shader', () => {
    expect(SCALAR_FRAGMENT_SHADER_SOURCE).toContain('if (isnan(value))')
    expect(SCALAR_FRAGMENT_SHADER_SOURCE).toContain('if (lower.y <= 0.0 && upper.y <= 0.0)')
    expect(SCALAR_FRAGMENT_SHADER_SOURCE).toContain('outColor = vec4(0.0);')
  })
})
