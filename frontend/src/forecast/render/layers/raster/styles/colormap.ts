import type {
  DisplayRange,
  GradientDisplayProfile,
} from '@/forecast/display'
import {
  samplePaletteColor,
  type PaletteSamplingMode,
  type PaletteColorStop,
} from '@/forecast/display/palette'
import type { RasterWindow } from '@/forecast/frames'

type RasterFrame = RasterWindow['lower']

export function createColormapKey(frame: RasterFrame): string {
  const display = gradientDisplay(frame)
  // Deterministic key for LUT texture reuse.
  return JSON.stringify({
    palette: display.palette.id,
    displayRange: display.range,
    stops: display.palette.stops,
  })
}

export function buildRasterColormapLut(
  frame: RasterFrame,
  size: number,
  paletteSamplingMode: PaletteSamplingMode
): Uint8Array {
  const display = gradientDisplay(frame)
  return buildColormapLut(
    display.palette.stops,
    display.range,
    size,
    paletteSamplingMode
  )
}

export function buildColormapLut(
  stops: readonly PaletteColorStop[],
  displayRange: DisplayRange,
  size: number,
  paletteSamplingMode: PaletteSamplingMode
): Uint8Array {
  const { min: rangeMin, max: rangeMax } = displayRange
  const span = Math.max(1e-6, rangeMax - rangeMin)
  const lut = new Uint8Array(size * 4)

  for (let idx = 0; idx < size; idx += 1) {
    const value = rangeMin + (span * idx) / Math.max(1, size - 1)
    const color = samplePaletteColor(stops, value, paletteSamplingMode)
    const offset = idx * 4
    lut[offset] = color[0]
    lut[offset + 1] = color[1]
    lut[offset + 2] = color[2]
    lut[offset + 3] = color[3]
  }

  return lut
}

function gradientDisplay(frame: RasterFrame): GradientDisplayProfile {
  const { display } = frame.source
  if (display.kind !== 'gradient') {
    throw new Error(`Colormap raster received ${display.kind} display profile`)
  }
  return display
}
