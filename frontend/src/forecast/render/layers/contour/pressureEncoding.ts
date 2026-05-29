import type { ContourWindow } from '@/forecast/frames'

type ContourWindowFrame = ContourWindow['lower']
type PressureEncoding = {
  format: string
  nodata?: number | null
  scale: number
  offset: number
}

export type PressureEncodingRenderSpec = {
  hasNodata: number
  nodata: number
  scale: number
  offset: number
}

export function pressureFramePairRenderSpec(
  lower: ContourWindowFrame,
  upper: ContourWindowFrame
): PressureEncodingRenderSpec {
  validatePressureFrameGrid(lower, upper)

  const lowerSpec = pressureEncodingRenderSpec(lower.raster.encoding as PressureEncoding)
  const upperSpec = pressureEncodingRenderSpec(upper.raster.encoding as PressureEncoding)
  if (
    lowerSpec.hasNodata !== upperSpec.hasNodata ||
    lowerSpec.nodata !== upperSpec.nodata ||
    lowerSpec.scale !== upperSpec.scale ||
    lowerSpec.offset !== upperSpec.offset
  ) {
    throw new Error('Pressure contour frames must share the same encoding')
  }

  return lowerSpec
}

function pressureEncodingRenderSpec(encoding: PressureEncoding): PressureEncodingRenderSpec {
  if (encoding.format !== 'linear-i8-v1') {
    throw new Error(`Unsupported pressure contour encoding: ${encoding.format}`)
  }

  return {
    hasNodata: 'nodata' in encoding ? 1 : 0,
    nodata: 'nodata' in encoding ? encoding.nodata ?? 0 : 0,
    scale: encoding.scale,
    offset: encoding.offset,
  }
}

function validatePressureFrameGrid(
  lower: ContourWindowFrame,
  upper: ContourWindowFrame
): void {
  const lowerGrid = lower.raster.grid
  const upperGrid = upper.raster.grid
  if (
    lowerGrid.nx !== upperGrid.nx ||
    lowerGrid.ny !== upperGrid.ny ||
    lowerGrid.lon0 !== upperGrid.lon0 ||
    lowerGrid.lat0 !== upperGrid.lat0 ||
    lowerGrid.dx !== upperGrid.dx ||
    lowerGrid.dy !== upperGrid.dy
  ) {
    throw new Error('Pressure contour frames must share the same grid')
  }
}
