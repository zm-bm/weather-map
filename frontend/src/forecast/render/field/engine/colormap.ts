import { getLayerPalette, type PaletteStop } from '@/forecast/palette'
import type { FieldTimeSliceData } from '@/forecast/data'
import type { FieldColorSamplingMode } from '@/forecast/settings/settings'
import { lerp } from '@/core/math'

type NormalizedColorStop = [number, number, number, number, number]
type SampledColor = [number, number, number, number]

export function createColormapKey(frame: FieldTimeSliceData): string {
  const palette = getLayerPalette(frame.paletteId)
  // Deterministic key for LUT texture reuse.
  return JSON.stringify({
    paletteId: frame.paletteId,
    displayRange: frame.displayRange,
    colorStops: palette.colorStops,
  })
}

export function buildFieldColormapLut(
  frame: FieldTimeSliceData,
  size: number,
  colorSamplingMode: FieldColorSamplingMode
): Uint8Array {
  return buildColormapLut(
    getLayerPalette(frame.paletteId).colorStops,
    frame.displayRange,
    size,
    colorSamplingMode
  )
}

export function buildColormapLut(
  colorStops: PaletteStop[],
  displayRange: [number, number],
  size: number,
  colorSamplingMode: FieldColorSamplingMode
): Uint8Array {
  // Normalize/sanitize stops before sampling into a fixed-size LUT.
  const [rangeMin, rangeMax] = displayRange
  const normalizedStops = normalizeColorStops(colorStops, displayRange)
  const safeStops = [...normalizedStops]
    .filter((stop) => (
      Number.isFinite(stop[0]) &&
      Number.isFinite(stop[1]) &&
      Number.isFinite(stop[2]) &&
      Number.isFinite(stop[3]) &&
      Number.isFinite(stop[4])
    ))
    .sort((a, b) => a[0] - b[0])
  const stops = safeStops.length > 0
    ? safeStops
    : [[rangeMin, 220, 220, 220, 255], [rangeMax, 80, 80, 80, 255]] as NormalizedColorStop[]
  const span = Math.max(1e-6, rangeMax - rangeMin)
  const lut = new Uint8Array(size * 4)

  for (let idx = 0; idx < size; idx += 1) {
    const value = rangeMin + (span * idx) / Math.max(1, size - 1)
    // Interpolated mode blends stops; banded mode treats stops as lower-bound thresholds.
    const color = colorSamplingMode === 'banded'
      ? sampleColorStopThreshold(stops, value)
      : sampleColorStops(stops, value)
    const offset = idx * 4
    lut[offset] = color[0]
    lut[offset + 1] = color[1]
    lut[offset + 2] = color[2]
    lut[offset + 3] = color[3]
  }

  return lut
}

function normalizeColorStops(
  colorStops: PaletteStop[],
  displayRange: [number, number]
): NormalizedColorStop[] {
  const [rangeMin, rangeMax] = displayRange
  if (colorStops.length === 0) return []

  const span = rangeMax - rangeMin
  const denominator = Math.max(1, colorStops.length - 1)

  return colorStops.map((stop, index) => {
    // Stop format: [value, r, g, b, a], [value, r, g, b], or [r, g, b].
    // When value is omitted, distribute stops evenly across the display range.
    if (stop.length === 5) {
      return [stop[0], stop[1], stop[2], stop[3], stop[4]]
    }
    if (stop.length === 4) {
      return [stop[0], stop[1], stop[2], stop[3], 255]
    }

    const value = rangeMin + (span * index) / denominator
    return [value, stop[0], stop[1], stop[2], 255]
  })
}

function sampleColorStops(stops: NormalizedColorStop[], value: number): SampledColor {
  // Piecewise-linear interpolation between adjacent stop pairs.
  if (stops.length === 1) {
    return [stops[0][1], stops[0][2], stops[0][3], stops[0][4]]
  }
  if (value <= stops[0][0]) {
    return [stops[0][1], stops[0][2], stops[0][3], stops[0][4]]
  }

  const last = stops[stops.length - 1]
  if (value >= last[0]) {
    return [last[1], last[2], last[3], last[4]]
  }

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    if (value < a[0] || value > b[0]) continue
    const span = Math.max(1e-6, b[0] - a[0])
    const t = (value - a[0]) / span
    return [
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
      Math.round(lerp(a[3], b[3], t)),
      Math.round(lerp(a[4], b[4], t)),
    ]
  }

  return [last[1], last[2], last[3], last[4]]
}

function sampleColorStopThreshold(stops: NormalizedColorStop[], value: number): SampledColor {
  // Lower-bound threshold lookup for banded mode.
  if (stops.length === 1) {
    return [stops[0][1], stops[0][2], stops[0][3], stops[0][4]]
  }

  let selected = stops[0]

  for (let i = 1; i < stops.length; i += 1) {
    const candidate = stops[i]
    if (value < candidate[0]) break
    selected = candidate
  }

  return [selected[1], selected[2], selected[3], selected[4]]
}
