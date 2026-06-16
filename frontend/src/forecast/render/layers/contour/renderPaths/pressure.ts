import { clamp } from '@/core/math'
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
export const PRESSURE_CONTOUR_SMOOTHING_KERNEL_TOTAL_WEIGHT =
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS.reduce((sum, weight) => sum + weight, 0)
export const PRESSURE_CONTOUR_MIN_COVERAGE = 0.875
export const PRESSURE_CONTOUR_EDGE_EPSILON_HPA = 1e-4
export const PRESSURE_CONTOUR_MAX_LEVELS_PER_CELL = 32
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

export type PressureFieldSample = {
  pressureHpa: number
  coverage: number
}

export type PressureMarchingSquareSaddlePairing =
  | 'none'
  | 'bottom-right/top-left'
  | 'bottom-left/right-top'

type Point = readonly [number, number]

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

export function smoothPressureField3x3(valuesHpa: readonly number[]): PressureFieldSample {
  const centerValue = valuesHpa[4] ?? Number.NaN
  if (!Number.isFinite(centerValue)) return missingPressureField()

  let weightedPressureHpa = 0
  let totalWeight = 0
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS.forEach((weight, index) => {
    const value = valuesHpa[index] ?? Number.NaN
    if (!Number.isFinite(value)) return
    weightedPressureHpa += value * weight
    totalWeight += weight
  })

  return totalWeight > 0
    ? {
        pressureHpa: weightedPressureHpa / totalWeight,
        coverage: totalWeight / PRESSURE_CONTOUR_SMOOTHING_KERNEL_TOTAL_WEIGHT,
      }
    : missingPressureField()
}

export function pressureMarchingSquareSegmentCount(
  cornersHpa: readonly number[],
  contourLevelHpa: number
): number {
  const pointCount = pressureMarchingSquareIntersectionPoints(cornersHpa, contourLevelHpa).length
  if (pointCount === 2) return 1
  if (pointCount === 4) return 2
  return 0
}

export function pressureContourLevelsForCell(cornersHpa: readonly number[]): number[] {
  if (cornersHpa.length < 4 || !cornersHpa.slice(0, 4).every(Number.isFinite)) {
    return []
  }

  const cellMin = Math.min(...cornersHpa.slice(0, 4))
  const cellMax = Math.max(...cornersHpa.slice(0, 4))
  if (cellMax - cellMin <= PRESSURE_CONTOUR_EDGE_EPSILON_HPA) return []

  const firstLevel = Math.ceil(
    (cellMin - PRESSURE_CONTOUR_EDGE_EPSILON_HPA) / PRESSURE_CONTOUR_INTERVAL_HPA
  ) * PRESSURE_CONTOUR_INTERVAL_HPA
  const levels: number[] = []
  for (let index = 0; index < PRESSURE_CONTOUR_MAX_LEVELS_PER_CELL; index += 1) {
    const level = firstLevel + (index * PRESSURE_CONTOUR_INTERVAL_HPA)
    if (level > cellMax + PRESSURE_CONTOUR_EDGE_EPSILON_HPA) break
    levels.push(level)
  }

  return levels
}

export function pressureMarchingSquareSaddlePairing(
  cornersHpa: readonly number[],
  contourLevelHpa: number
): PressureMarchingSquareSaddlePairing {
  if (pressureMarchingSquareIntersectionPoints(cornersHpa, contourLevelHpa).length !== 4) {
    return 'none'
  }

  const [s00, s10, s01, s11] = cornersHpa
  const s00High = pressureContourSide(s00, contourLevelHpa) > 0
  const s10High = pressureContourSide(s10, contourLevelHpa) > 0
  const s01High = pressureContourSide(s01, contourLevelHpa) > 0
  const s11High = pressureContourSide(s11, contourLevelHpa) > 0
  if (s00High !== s11High || s10High !== s01High || s00High === s10High) {
    return 'none'
  }

  const centerHpa = (s00 + s10 + s01 + s11) * 0.25
  const centerHigh = pressureContourSide(centerHpa, contourLevelHpa) > 0
  return centerHigh === s00High
    ? 'bottom-right/top-left'
    : 'bottom-left/right-top'
}

export function interpolatePressureField(args: {
  lower: PressureFieldSample
  upper: PressureFieldSample
  mix: number
}): PressureFieldSample {
  const mixValue = clamp(args.mix, 0, 1)
  if (mixValue <= 0) return isPressureFieldContourable(args.lower) ? args.lower : missingPressureField()
  if (mixValue >= 1) return isPressureFieldContourable(args.upper) ? args.upper : missingPressureField()
  if (!isPressureFieldContourable(args.lower) || !isPressureFieldContourable(args.upper)) {
    return missingPressureField()
  }

  return {
    pressureHpa: args.lower.pressureHpa + ((args.upper.pressureHpa - args.lower.pressureHpa) * mixValue),
    coverage: Math.min(args.lower.coverage, args.upper.coverage),
  }
}

export function isPressureFieldContourable(sample: PressureFieldSample): boolean {
  return Number.isFinite(sample.pressureHpa) && sample.coverage >= PRESSURE_CONTOUR_MIN_COVERAGE
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

function missingPressureField(): PressureFieldSample {
  return { pressureHpa: Number.NaN, coverage: 0 }
}

function pressureMarchingSquareIntersectionPoints(
  cornersHpa: readonly number[],
  contourLevelHpa: number
): Point[] {
  if (
    cornersHpa.length < 4 ||
    !Number.isFinite(contourLevelHpa) ||
    !cornersHpa.slice(0, 4).every(Number.isFinite)
  ) {
    return []
  }

  const [s00, s10, s01, s11] = cornersHpa
  const points: Point[] = []
  addPressureEdgeIntersection(points, [0, 0], [1, 0], s00, s10, contourLevelHpa)
  addPressureEdgeIntersection(points, [1, 0], [1, 1], s10, s11, contourLevelHpa)
  addPressureEdgeIntersection(points, [1, 1], [0, 1], s11, s01, contourLevelHpa)
  addPressureEdgeIntersection(points, [0, 1], [0, 0], s01, s00, contourLevelHpa)
  return points
}

function addPressureEdgeIntersection(
  points: Point[],
  aPoint: Point,
  bPoint: Point,
  aHpa: number,
  bHpa: number,
  contourLevelHpa: number
): void {
  if (!pressureEdgeCrossesContour(aHpa, bHpa, contourLevelHpa)) return

  const aDistance = aHpa - contourLevelHpa
  const bDistance = bHpa - contourLevelHpa
  const point = Math.abs(aDistance) <= PRESSURE_CONTOUR_EDGE_EPSILON_HPA
    ? aPoint
    : Math.abs(bDistance) <= PRESSURE_CONTOUR_EDGE_EPSILON_HPA
      ? bPoint
      : interpolatePoint(aPoint, bPoint, -aDistance / (bDistance - aDistance))

  if (!points.some((existing) => pointsEqual(existing, point))) {
    points.push(point)
  }
}

function pressureEdgeCrossesContour(
  aHpa: number,
  bHpa: number,
  contourLevelHpa: number
): boolean {
  const aDistance = pressureContourSide(aHpa, contourLevelHpa)
  const bDistance = pressureContourSide(bHpa, contourLevelHpa)
  return aDistance * bDistance < 0
}

function pressureContourSide(pressureHpa: number, contourLevelHpa: number): number {
  const distance = pressureHpa - contourLevelHpa
  return Math.abs(distance) <= PRESSURE_CONTOUR_EDGE_EPSILON_HPA
    ? PRESSURE_CONTOUR_EDGE_EPSILON_HPA
    : distance
}

function interpolatePoint(aPoint: Point, bPoint: Point, t: number): Point {
  const value = clamp(t, 0, 1)
  return [
    aPoint[0] + ((bPoint[0] - aPoint[0]) * value),
    aPoint[1] + ((bPoint[1] - aPoint[1]) * value),
  ]
}

function pointsEqual(aPoint: Point, bPoint: Point): boolean {
  return Math.abs(aPoint[0] - bPoint[0]) <= 1e-5 &&
    Math.abs(aPoint[1] - bPoint[1]) <= 1e-5
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
