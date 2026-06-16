import { clamp, smoothstep, wrap } from '@/core/math'
import { sourceBandIds } from '@/forecast/catalog/source'
import type { ContourWindow } from '@/forecast/frames'
import {
  encodedRasterFrameSpec,
  type EncodedGridFrameSpec,
} from '../../../encodedGrid'

export const PRESSURE_CONTOUR_INTERVAL_HPA = 4
export const PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX = 0.20
export const PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX = 0.80
export const PRESSURE_CONTOUR_MAIN_ALPHA = 0.75
export const PRESSURE_CONTOUR_HALO_ALPHA = 0.25
export const PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS = [1, 2, 1, 2, 4, 2, 1, 2, 1] as const
export const PRESSURE_CONTOUR_MAIN_COLOR_RGB = [1, 1, 1] as const
export const PRESSURE_CONTOUR_HALO_COLOR_RGB = [0.07, 0.09, 0.12] as const

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

export function pressureEncodedGridFrameSpec(frame: ContourWindowFrame): EncodedGridFrameSpec {
  return encodedRasterFrameSpec({
    raster: frame.raster,
    expectedBandIds: sourceBandIds(frame.source.source),
    label: `pressure contour ${frame.raster.artifactId}`,
  })
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

export function pressureContourPhaseDistanceHpa(pressureHpa: number): number {
  if (!Number.isFinite(pressureHpa)) return Number.NaN
  const phase = wrap(pressureHpa, PRESSURE_CONTOUR_INTERVAL_HPA)
  return Math.min(phase, PRESSURE_CONTOUR_INTERVAL_HPA - phase)
}

export function smoothPressureHpa3x3(valuesHpa: readonly number[]): number {
  const centerValue = valuesHpa[4] ?? Number.NaN
  if (!Number.isFinite(centerValue)) return Number.NaN

  let weightedPressureHpa = 0
  let totalWeight = 0
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS.forEach((weight, index) => {
    const value = valuesHpa[index] ?? Number.NaN
    if (!Number.isFinite(value)) return
    weightedPressureHpa += value * weight
    totalWeight += weight
  })

  return totalWeight > 0 ? weightedPressureHpa / totalWeight : Number.NaN
}

export function pressureContourPhaseBandAlpha(args: {
  distanceHpa: number
  pressureDerivativeHpa: number
  halfWidthPx: number
}): number {
  if (
    !Number.isFinite(args.distanceHpa) ||
    !Number.isFinite(args.pressureDerivativeHpa) ||
    !Number.isFinite(args.halfWidthPx) ||
    args.pressureDerivativeHpa <= 1e-5
  ) {
    return 0
  }

  const derivative = Math.max(args.pressureDerivativeHpa, 1e-4)
  const inner = derivative * Math.max(0, args.halfWidthPx)
  const outer = derivative * (Math.max(0, args.halfWidthPx) + 1)
  return 1 - smoothstep(inner, outer, args.distanceHpa)
}

export function pressureContourPhaseBandWeights(args: {
  pressureHpa: number
  pressureDerivativeHpa: number
}): {
  mainAlpha: number
  haloAlpha: number
} {
  const distanceHpa = pressureContourPhaseDistanceHpa(args.pressureHpa)
  const mainAlpha = pressureContourPhaseBandAlpha({
    distanceHpa,
    pressureDerivativeHpa: args.pressureDerivativeHpa,
    halfWidthPx: PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  }) * PRESSURE_CONTOUR_MAIN_ALPHA
  const haloAlpha = pressureContourPhaseBandAlpha({
    distanceHpa,
    pressureDerivativeHpa: args.pressureDerivativeHpa,
    halfWidthPx: PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  }) * PRESSURE_CONTOUR_HALO_ALPHA

  return { mainAlpha, haloAlpha }
}

export function interpolatePressureHpa(args: {
  lowerHpa: number
  upperHpa: number
  mix: number
}): number {
  const lowerFinite = Number.isFinite(args.lowerHpa)
  const upperFinite = Number.isFinite(args.upperHpa)
  if (!lowerFinite && !upperFinite) return Number.NaN
  if (!lowerFinite) return args.upperHpa
  if (!upperFinite) return args.lowerHpa
  return args.lowerHpa + ((args.upperHpa - args.lowerHpa) * clamp(args.mix, 0, 1))
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
