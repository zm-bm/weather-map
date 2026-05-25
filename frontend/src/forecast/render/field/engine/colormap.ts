import {
  getLayerPalette,
  samplePaletteColor,
  type PaletteColorStop,
} from '@/forecast/palette'
import type { FieldTimeSliceData } from '@/forecast/data'
import type { FieldColorSamplingMode } from '@/forecast/settings/settings'

export function createColormapKey(frame: FieldTimeSliceData): string {
  const palette = getLayerPalette(frame.paletteId)
  // Deterministic key for LUT texture reuse.
  return JSON.stringify({
    paletteId: frame.paletteId,
    displayRange: frame.displayRange,
    stops: palette.stops,
  })
}

export function buildFieldColormapLut(
  frame: FieldTimeSliceData,
  size: number,
  colorSamplingMode: FieldColorSamplingMode
): Uint8Array {
  return buildColormapLut(
    getLayerPalette(frame.paletteId).stops,
    frame.displayRange,
    size,
    colorSamplingMode
  )
}

export function buildColormapLut(
  stops: readonly PaletteColorStop[],
  displayRange: [number, number],
  size: number,
  colorSamplingMode: FieldColorSamplingMode
): Uint8Array {
  const [rangeMin, rangeMax] = displayRange
  const span = Math.max(1e-6, rangeMax - rangeMin)
  const lut = new Uint8Array(size * 4)

  for (let idx = 0; idx < size; idx += 1) {
    const value = rangeMin + (span * idx) / Math.max(1, size - 1)
    const color = samplePaletteColor(stops, value, colorSamplingMode)
    const offset = idx * 4
    lut[offset] = color[0]
    lut[offset + 1] = color[1]
    lut[offset + 2] = color[2]
    lut[offset + 3] = color[3]
  }

  return lut
}
