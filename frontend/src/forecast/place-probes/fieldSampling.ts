import {
  type FieldTimeSliceData,
  type FieldInterpolationWindowData,
} from '@/forecast/data'
import { clamp, clamp01, wrap } from '@/core/math'

export type FieldProbePoint = {
  x: number
  y: number
  lon: number
  lat: number
  value: number | null
  weight: number
}

export type FieldProbeResult = {
  lon: number
  lat: number
  gridX: number
  gridY: number
  value: number | null
  points: [FieldProbePoint, FieldProbePoint, FieldProbePoint, FieldProbePoint]
}

export type FieldInterpolationWindowProbeResult = {
  lon: number
  lat: number
  mix: number
  value: number | null
  lower: FieldProbeResult
  upper: FieldProbeResult
}

export type FieldProbeSampleCell = {
  index: number
  weight: number
}

export type FieldProbeSampler = {
  lon: number
  lat: number
  nx: number
  ny: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  xWrap: FieldTimeSliceData['grid']['xWrap']
  yMode: FieldTimeSliceData['grid']['yMode']
  cells: [
    FieldProbeSampleCell,
    FieldProbeSampleCell,
    FieldProbeSampleCell,
    FieldProbeSampleCell,
  ]
}

export function probeFieldTimeSlice(
  frame: FieldTimeSliceData,
  coords: { lon: number; lat: number },
): FieldProbeResult | null {
  const { grid, values } = frame
  const { nx, ny, lon0, lat0, dx, dy } = grid
  if (nx < 1 || ny < 1 || dx === 0 || dy === 0) return null
  if (values.length !== nx * ny) return null

  const gridX = toGridCoord(coords.lon, lon0, dx, nx, grid.xWrap === 'repeat')
  const gridY = clamp((coords.lat - lat0) / dy, 0, ny - 1)

  const x0 = Math.floor(gridX)
  const y0 = Math.floor(gridY)
  const x1 = grid.xWrap === 'repeat'
    ? wrapIndex(x0 + 1, nx)
    : Math.min(x0 + 1, nx - 1)
  const y1 = Math.min(y0 + 1, ny - 1)

  const tx = gridX - x0
  const ty = gridY - y0

  const points: FieldProbeResult['points'] = [
    buildPoint(frame, x0, y0, (1 - tx) * (1 - ty)),
    buildPoint(frame, x1, y0, tx * (1 - ty)),
    buildPoint(frame, x0, y1, (1 - tx) * ty),
    buildPoint(frame, x1, y1, tx * ty),
  ]

  let totalWeight = 0
  let totalValue = 0
  for (const point of points) {
    if (point.value == null) continue
    totalWeight += point.weight
    totalValue += point.value * point.weight
  }

  return {
    lon: coords.lon,
    lat: coords.lat,
    gridX,
    gridY,
    value: totalWeight > 0 ? totalValue / totalWeight : null,
    points,
  }
}

export function createFieldProbeSampler(
  frame: FieldTimeSliceData,
  coords: { lon: number; lat: number },
): FieldProbeSampler | null {
  const { grid, values } = frame
  const { nx, ny, lon0, lat0, dx, dy } = grid
  if (nx < 1 || ny < 1 || dx === 0 || dy === 0) return null
  if (values.length !== nx * ny) return null

  const gridX = toGridCoord(coords.lon, lon0, dx, nx, grid.xWrap === 'repeat')
  const gridY = clamp((coords.lat - lat0) / dy, 0, ny - 1)

  const x0 = Math.floor(gridX)
  const y0 = Math.floor(gridY)
  const x1 = grid.xWrap === 'repeat'
    ? wrapIndex(x0 + 1, nx)
    : Math.min(x0 + 1, nx - 1)
  const y1 = Math.min(y0 + 1, ny - 1)

  const tx = gridX - x0
  const ty = gridY - y0

  return {
    lon: coords.lon,
    lat: coords.lat,
    nx,
    ny,
    lon0,
    lat0,
    dx,
    dy,
    xWrap: grid.xWrap,
    yMode: grid.yMode,
    cells: [
      { index: (y0 * nx) + x0, weight: (1 - tx) * (1 - ty) },
      { index: (y0 * nx) + x1, weight: tx * (1 - ty) },
      { index: (y1 * nx) + x0, weight: (1 - tx) * ty },
      { index: (y1 * nx) + x1, weight: tx * ty },
    ],
  }
}

export function isFieldProbeSamplerCompatible(
  frame: FieldTimeSliceData,
  sampler: FieldProbeSampler
): boolean {
  return frame.grid.nx === sampler.nx &&
    frame.grid.ny === sampler.ny &&
    frame.grid.lon0 === sampler.lon0 &&
    frame.grid.lat0 === sampler.lat0 &&
    frame.grid.dx === sampler.dx &&
    frame.grid.dy === sampler.dy &&
    frame.grid.xWrap === sampler.xWrap &&
    frame.grid.yMode === sampler.yMode &&
    frame.values.length === sampler.nx * sampler.ny
}

export function sampleFieldTimeSliceWithSampler(
  frame: FieldTimeSliceData,
  sampler: FieldProbeSampler
): number | null {
  if (!isFieldProbeSamplerCompatible(frame, sampler)) return null

  let totalWeight = 0
  let totalValue = 0
  for (const cell of sampler.cells) {
    const value = frame.values[cell.index]
    if (value == null || Number.isNaN(value)) continue
    totalWeight += cell.weight
    totalValue += value * cell.weight
  }

  return totalWeight > 0 ? totalValue / totalWeight : null
}

export function blendFieldValues(
  lowerValue: number | null,
  upperValue: number | null,
  mix: number
): number | null {
  const normalizedMix = Number.isFinite(mix) ? clamp01(mix) : 0
  if (lowerValue == null && upperValue == null) return null
  if (lowerValue == null) return upperValue
  if (upperValue == null) return lowerValue
  return lowerValue + ((upperValue - lowerValue) * normalizedMix)
}

export function sampleFieldWindowWithSampler(
  interpolationWindow: FieldInterpolationWindowData,
  sampler: FieldProbeSampler,
): number | null {
  const lowerValue = sampleFieldTimeSliceWithSampler(interpolationWindow.lower, sampler)
  const canBlend = interpolationWindow.mix > 0 &&
    isFieldProbeSamplerCompatible(interpolationWindow.upper, sampler)
  const upperValue = canBlend
    ? sampleFieldTimeSliceWithSampler(interpolationWindow.upper, sampler)
    : lowerValue

  return blendFieldValues(lowerValue, upperValue, canBlend ? interpolationWindow.mix : 0)
}

export function probeFieldInterpolationWindow(
  interpolationWindow: FieldInterpolationWindowData,
  coords: { lon: number; lat: number },
): FieldInterpolationWindowProbeResult | null {
  const lower = probeFieldTimeSlice(interpolationWindow.lower, coords)
  if (!lower) return null

  const canBlend = interpolationWindow.mix > 0
  const upper = canBlend
    ? (probeFieldTimeSlice(interpolationWindow.upper, coords) ?? lower)
    : lower

  return {
    lon: coords.lon,
    lat: coords.lat,
    mix: canBlend ? interpolationWindow.mix : 0,
    value: blendFieldValues(lower.value, upper.value, canBlend ? interpolationWindow.mix : 0),
    lower,
    upper,
  }
}

function buildPoint(
  frame: FieldTimeSliceData,
  x: number,
  y: number,
  weight: number,
): FieldProbePoint {
  const value = decodeValue(frame, x, y)
  return {
    x,
    y,
    lon: frame.grid.lon0 + (x * frame.grid.dx),
    lat: frame.grid.lat0 + (y * frame.grid.dy),
    value,
    weight,
  }
}

function decodeValue(frame: FieldTimeSliceData, x: number, y: number): number | null {
  const value = frame.values[(y * frame.grid.nx) + x]
  return Number.isNaN(value) ? null : value
}

function toGridCoord(
  value: number,
  origin: number,
  step: number,
  span: number,
  repeats: boolean,
) {
  const rawCoord = (value - origin) / step
  return repeats
    ? wrap(rawCoord, span)
    : clamp(rawCoord, 0, span - 1)
}

function wrapIndex(value: number, span: number) {
  return Math.floor(wrap(value, span))
}
