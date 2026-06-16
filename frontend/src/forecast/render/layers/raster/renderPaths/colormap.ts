import type {
  DisplayRange,
  GradientDisplayProfile,
} from '@/forecast/display'
import {
  hasExactBandIds,
  sourceBandIds,
} from '@/forecast/catalog/source'
import {
  samplePaletteColor,
  type PaletteSamplingMode,
  type PaletteColorStop,
} from '@/forecast/display/palette'
import type { RasterWindow } from '@/forecast/frames'
import {
  assertEncodedRasterBandIds,
  encodedRasterFrameSpec,
  type EncodedGridBand,
  type EncodedGridFrameSpec,
} from '../../../encodedGrid'

type RasterFrame = RasterWindow['lower']
type ScalarColormapEncoding = {
  format: string
  nodata?: number | null
  scale?: number
  offset?: number
}
type VectorColormapEncoding = {
  nodata?: number | null
  scale: number
  offset: number
}

export const COLORMAP_SOURCE_MODE_LINEAR = 0
export const COLORMAP_SOURCE_MODE_TEMP_C = 1
export const COLORMAP_SOURCE_MODE_WIND_SPEED = 2

export type ColormapRasterRenderSpec = {
  mode: number
  hasNodata: number
  nodata: number
  scale: number
  offset: number
  bands: EncodedGridBand[]
}

export function isColormapRasterFrame(frame: RasterFrame): boolean {
  return isValueRasterFrame(frame) || isWindSpeedRasterFrame(frame)
}

export function colormapRasterRenderSpec(frame: RasterFrame): ColormapRasterRenderSpec {
  const { raster } = frame

  if (isValueRasterFrame(frame)) {
    assertEncodedRasterBandIds({
      raster,
      expectedBandIds: sourceBandIds(frame.source),
      label: `Colormap raster ${frame.source.layerId}`,
    })
    const encoding = raster.encoding as ScalarColormapEncoding
    return {
      mode: encoding.format === 'temp-c-piecewise-i8-v1'
        ? COLORMAP_SOURCE_MODE_TEMP_C
        : COLORMAP_SOURCE_MODE_LINEAR,
      hasNodata: encoding.nodata == null ? 0 : 1,
      nodata: encoding.nodata ?? 0,
      scale: encoding.scale ?? 1,
      offset: encoding.offset ?? 0,
      bands: [...raster.bands],
    }
  }

  if (isWindSpeedRasterFrame(frame)) {
    assertEncodedRasterBandIds({
      raster,
      expectedBandIds: sourceBandIds(frame.source),
      label: `Colormap raster ${frame.source.layerId}`,
    })
    const encoding = raster.encoding as VectorColormapEncoding
    return {
      mode: COLORMAP_SOURCE_MODE_WIND_SPEED,
      hasNodata: encoding.nodata == null ? 0 : 1,
      nodata: encoding.nodata ?? 0,
      scale: encoding.scale,
      offset: encoding.offset,
      bands: [...raster.bands],
    }
  }

  throw new Error('Unsupported colormap raster source')
}

export function colormapEncodedGridFrameSpec(frame: RasterFrame): EncodedGridFrameSpec {
  if (!isColormapRasterFrame(frame)) {
    throw new Error('Colormap raster received non-colormap source')
  }
  const renderSpec = colormapRasterRenderSpec(frame)
  return {
    ...encodedRasterFrameSpec({
      raster: frame.raster,
      expectedBandIds: sourceBandIds(frame.source),
      label: `colormap raster ${frame.source.layerId}`,
    }),
    bands: renderSpec.bands,
  }
}

export function validateColormapRasterGrid(frame: RasterFrame): void {
  const expectedCellCount = frame.raster.grid.nx * frame.raster.grid.ny
  for (const band of colormapRasterRenderSpec(frame).bands) {
    if (band.length !== expectedCellCount) {
      throw new Error(`Unexpected colormap source grid size for ${frame.source.layerId}: got=${band.length} expected=${expectedCellCount}`)
    }
  }
}

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

function isValueRasterFrame(frame: RasterFrame): boolean {
  return hasExactBandIds(sourceBandIds(frame.source), ['value'])
}

function isWindSpeedRasterFrame(frame: RasterFrame): boolean {
  return hasExactBandIds(sourceBandIds(frame.source), ['u', 'v'])
}
