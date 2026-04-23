import type { ScalarFrameData } from './engine/types'

export type ScalarProbePoint = {
  x: number
  y: number
  lon: number
  lat: number
  value: number | null
  weight: number
}

export type ScalarProbeResult = {
  lon: number
  lat: number
  gridX: number
  gridY: number
  value: number | null
  points: [ScalarProbePoint, ScalarProbePoint, ScalarProbePoint, ScalarProbePoint]
}

export function probeScalarFrame(
  frame: ScalarFrameData,
  coords: { lon: number; lat: number },
): ScalarProbeResult | null {
  const { grid, values } = frame
  const { nx, ny, lon0, lat0, dx, dy } = grid
  if (nx < 1 || ny < 1 || dx === 0 || dy === 0) return null
  if (values.length !== nx * ny) return null

  const gridX = toGridCoord(coords.lon, lon0, dx, nx, grid.x_wrap === 'repeat')
  const gridY = clamp((coords.lat - lat0) / dy, 0, ny - 1)

  const x0 = Math.floor(gridX)
  const y0 = Math.floor(gridY)
  const x1 = grid.x_wrap === 'repeat'
    ? wrapIndex(x0 + 1, nx)
    : Math.min(x0 + 1, nx - 1)
  const y1 = Math.min(y0 + 1, ny - 1)

  const tx = gridX - x0
  const ty = gridY - y0

  const points: ScalarProbeResult['points'] = [
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

function buildPoint(
  frame: ScalarFrameData,
  x: number,
  y: number,
  weight: number,
): ScalarProbePoint {
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

function decodeValue(frame: ScalarFrameData, x: number, y: number): number | null {
  const stored = frame.values[(y * frame.grid.nx) + x]
  if (stored === frame.encoding.nodata) return null
  return (stored * frame.encoding.scale) + frame.encoding.offset
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

function wrap(value: number, span: number) {
  if (span <= 0) return value
  const wrapped = value % span
  return wrapped < 0 ? wrapped + span : wrapped
}

function wrapIndex(value: number, span: number) {
  return Math.floor(wrap(value, span))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
