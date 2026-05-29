import { lerp } from '@/core/math'
import { BUILT_IN_RASTER_PALETTES } from './definitions'
import {
  parseForecastPalettes,
  type RasterPaletteDefinition,
  type PaletteColor,
  type PaletteColorStop,
} from './schema'

export type {
  RasterPaletteDefinition,
  PaletteColor,
  PaletteColorStop,
} from './schema'

export type PaletteSamplingMode = 'banded' | 'interpolated'

export type SampledPaletteColor = readonly [number, number, number, number]

export const RASTER_PALETTES = parseForecastPalettes(BUILT_IN_RASTER_PALETTES)

const RASTER_PALETTES_BY_ID: Record<string, RasterPaletteDefinition> = Object.fromEntries(
  RASTER_PALETTES.map((palette) => [palette.id, palette])
)

export function isRasterPaletteId(paletteId: unknown): paletteId is string {
  return typeof paletteId === 'string' && RASTER_PALETTES_BY_ID[paletteId] != null
}

export function getRasterPalette(paletteId: string): RasterPaletteDefinition {
  const palette = RASTER_PALETTES_BY_ID[paletteId]
  if (!palette) {
    throw new Error(`Unknown raster paletteId: ${paletteId}`)
  }
  return palette
}

export function normalizePaletteColor(color: PaletteColor): SampledPaletteColor {
  return [color[0], color[1], color[2], color[3] ?? 255]
}

export function samplePaletteColor(
  stops: readonly PaletteColorStop[],
  value: number,
  samplingMode: PaletteSamplingMode,
): SampledPaletteColor {
  if (stops.length === 0) return [220, 220, 220, 255]
  if (samplingMode === 'banded') return sampleThresholdColor(stops, value)
  return sampleInterpolatedColor(stops, value)
}

function sampleThresholdColor(
  stops: readonly PaletteColorStop[],
  value: number,
): SampledPaletteColor {
  let selected = stops[0]!

  for (let index = 1; index < stops.length; index += 1) {
    const candidate = stops[index]!
    if (value < candidate.value) break
    selected = candidate
  }

  return normalizePaletteColor(selected.color)
}

function sampleInterpolatedColor(
  stops: readonly PaletteColorStop[],
  value: number,
): SampledPaletteColor {
  if (stops.length === 1) return normalizePaletteColor(stops[0]!.color)

  const first = stops[0]!
  if (value <= first.value) return normalizePaletteColor(first.color)

  const last = stops[stops.length - 1]!
  if (value >= last.value) return normalizePaletteColor(last.color)

  for (let index = 0; index < stops.length - 1; index += 1) {
    const lowerStop = stops[index]!
    const upperStop = stops[index + 1]!
    if (value < lowerStop.value || value > upperStop.value) continue

    const lowerColor = normalizePaletteColor(lowerStop.color)
    const upperColor = normalizePaletteColor(upperStop.color)
    const span = Math.max(1e-6, upperStop.value - lowerStop.value)
    const t = (value - lowerStop.value) / span

    return [
      Math.round(lerp(lowerColor[0], upperColor[0], t)),
      Math.round(lerp(lowerColor[1], upperColor[1], t)),
      Math.round(lerp(lowerColor[2], upperColor[2], t)),
      Math.round(lerp(lowerColor[3], upperColor[3], t)),
    ]
  }

  return normalizePaletteColor(last.color)
}
