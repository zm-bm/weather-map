import {
  effectiveGridBoundaryModes,
  gridCoordIsInsideDomain,
  type ProbeWindow,
} from '@/forecast/frames'
import { clamp, clamp01, wrap } from '@/core/math'

type ProbeFrame = ProbeWindow['lower']
type ScalarProbeEncoding =
  | { format: 'temp-c-piecewise-i8-v1'; nodata: number }
  | { format: 'linear-i8-v1'; nodata: number; scale: number; offset: number }
type VectorProbeEncoding = {
  nodata?: number
  scale: number
  offset: number
}

type RasterCellDecoder = {
  bandIds: readonly string[]
  decode: (frame: ProbeFrame, index: number) => number | null
}

const RASTER_CELL_DECODERS: readonly RasterCellDecoder[] = [
  {
    bandIds: ['value'],
    decode: decodeScalarRasterCell,
  },
  {
    bandIds: ['u', 'v'],
    decode: decodeWindSpeedRasterCell,
  },
  {
    bandIds: ['low', 'middle', 'high'],
    decode: decodeCloudCoverageRasterCell,
  },
]

export type RasterProbePoint = {
  x: number
  y: number
  lon: number
  lat: number
  value: number | null
  weight: number
}

export type RasterProbeResult = {
  lon: number
  lat: number
  gridX: number
  gridY: number
  value: number | null
  points: [RasterProbePoint, RasterProbePoint, RasterProbePoint, RasterProbePoint]
}

export type RasterWindowProbeResult = {
  lon: number
  lat: number
  mix: number
  value: number | null
  lower: RasterProbeResult
  upper: RasterProbeResult
}

export type RasterProbeSampleCell = {
  index: number
  weight: number
}

export type RasterProbeSampler = {
  lon: number
  lat: number
  nx: number
  ny: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  x_wrap: ProbeFrame['raster']['grid']['x_wrap']
  y_mode: ProbeFrame['raster']['grid']['y_mode']
  cells: [
    RasterProbeSampleCell,
    RasterProbeSampleCell,
    RasterProbeSampleCell,
    RasterProbeSampleCell,
  ]
}

type RasterSampleGeometryCell = RasterProbeSampleCell & {
  x: number
  y: number
}

type RasterSampleGeometry = Omit<RasterProbeSampler, 'cells'> & {
  gridX: number
  gridY: number
  cells: [
    RasterSampleGeometryCell,
    RasterSampleGeometryCell,
    RasterSampleGeometryCell,
    RasterSampleGeometryCell,
  ]
}

export function probeRasterFrame(
  frame: ProbeFrame,
  coords: { lon: number; lat: number },
): RasterProbeResult | null {
  const geometry = createRasterSampleGeometry(frame, coords)
  if (geometry == null) return null

  const points: RasterProbeResult['points'] = [
    buildPoint(frame, geometry.cells[0]),
    buildPoint(frame, geometry.cells[1]),
    buildPoint(frame, geometry.cells[2]),
    buildPoint(frame, geometry.cells[3]),
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
    gridX: geometry.gridX,
    gridY: geometry.gridY,
    value: totalWeight > 0 ? totalValue / totalWeight : null,
    points,
  }
}

export function createRasterProbeSampler(
  frame: ProbeFrame,
  coords: { lon: number; lat: number },
): RasterProbeSampler | null {
  const geometry = createRasterSampleGeometry(frame, coords)
  if (geometry == null) return null

  return {
    lon: coords.lon,
    lat: coords.lat,
    nx: geometry.nx,
    ny: geometry.ny,
    lon0: geometry.lon0,
    lat0: geometry.lat0,
    dx: geometry.dx,
    dy: geometry.dy,
    x_wrap: geometry.x_wrap,
    y_mode: geometry.y_mode,
    cells: [
      toProbeSampleCell(geometry.cells[0]),
      toProbeSampleCell(geometry.cells[1]),
      toProbeSampleCell(geometry.cells[2]),
      toProbeSampleCell(geometry.cells[3]),
    ],
  }
}

export function isRasterProbeSamplerCompatible(
  frame: ProbeFrame,
  sampler: RasterProbeSampler
): boolean {
  const { grid } = frame.raster
  const modes = effectiveGridBoundaryModes(grid)
  return grid.nx === sampler.nx &&
    grid.ny === sampler.ny &&
    grid.lon0 === sampler.lon0 &&
    grid.lat0 === sampler.lat0 &&
    grid.dx === sampler.dx &&
    grid.dy === sampler.dy &&
    modes.xWrap === sampler.x_wrap &&
    modes.yMode === sampler.y_mode &&
    hasExpectedRasterCellCount(frame, sampler.nx * sampler.ny)
}

export function sampleRasterFrameWithSampler(
  frame: ProbeFrame,
  sampler: RasterProbeSampler
): number | null {
  if (!isRasterProbeSamplerCompatible(frame, sampler)) return null

  let totalWeight = 0
  let totalValue = 0
  for (const cell of sampler.cells) {
    const value = decodeRasterCell(frame, cell.index)
    if (value == null) continue
    totalWeight += cell.weight
    totalValue += value * cell.weight
  }

  return totalWeight > 0 ? totalValue / totalWeight : null
}

export function blendRasterValues(
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

export function sampleRasterWindowWithSampler(
  window: ProbeWindow,
  sampler: RasterProbeSampler,
): number | null {
  const lowerValue = sampleRasterFrameWithSampler(window.lower, sampler)
  const canBlend = window.mix > 0 &&
    isRasterProbeSamplerCompatible(window.upper, sampler)
  const upperValue = canBlend
    ? sampleRasterFrameWithSampler(window.upper, sampler)
    : lowerValue

  return blendRasterValues(lowerValue, upperValue, canBlend ? window.mix : 0)
}

export function probeRasterWindow(
  window: ProbeWindow,
  coords: { lon: number; lat: number },
): RasterWindowProbeResult | null {
  const lower = probeRasterFrame(window.lower, coords)
  if (!lower) return null

  const canBlend = window.mix > 0
  const upper = canBlend
    ? (probeRasterFrame(window.upper, coords) ?? lower)
    : lower

  return {
    lon: coords.lon,
    lat: coords.lat,
    mix: canBlend ? window.mix : 0,
    value: blendRasterValues(lower.value, upper.value, canBlend ? window.mix : 0),
    lower,
    upper,
  }
}

function createRasterSampleGeometry(
  frame: ProbeFrame,
  coords: { lon: number; lat: number },
): RasterSampleGeometry | null {
  const { grid } = frame.raster
  const { nx, ny, lon0, lat0, dx, dy } = grid
  if (nx < 1 || ny < 1 || dx === 0 || dy === 0) return null
  if (!hasExpectedRasterCellCount(frame, nx * ny)) return null

  const rawGridX = (coords.lon - lon0) / dx
  const rawGridY = (coords.lat - lat0) / dy
  if (!gridCoordIsInsideDomain({ grid, gridX: rawGridX, gridY: rawGridY })) return null

  const modes = effectiveGridBoundaryModes(grid)
  const gridX = modes.xWrap === 'repeat'
    ? wrap(rawGridX, nx)
    : clamp(rawGridX, 0, nx - 1)
  const gridY = clamp(rawGridY, 0, ny - 1)

  const x0 = Math.floor(gridX)
  const y0 = Math.floor(gridY)
  const x1 = modes.xWrap === 'repeat'
    ? wrapIndex(x0 + 1, nx)
    : Math.min(x0 + 1, nx - 1)
  const y1 = Math.min(y0 + 1, ny - 1)

  const tx = gridX - x0
  const ty = gridY - y0

  return {
    lon: coords.lon,
    lat: coords.lat,
    gridX,
    gridY,
    nx,
    ny,
    lon0,
    lat0,
    dx,
    dy,
    x_wrap: modes.xWrap,
    y_mode: modes.yMode,
    cells: [
      createSampleGeometryCell(x0, y0, nx, (1 - tx) * (1 - ty)),
      createSampleGeometryCell(x1, y0, nx, tx * (1 - ty)),
      createSampleGeometryCell(x0, y1, nx, (1 - tx) * ty),
      createSampleGeometryCell(x1, y1, nx, tx * ty),
    ],
  }
}

function createSampleGeometryCell(
  x: number,
  y: number,
  nx: number,
  weight: number,
): RasterSampleGeometryCell {
  return {
    x,
    y,
    index: (y * nx) + x,
    weight,
  }
}

function toProbeSampleCell(cell: RasterSampleGeometryCell): RasterProbeSampleCell {
  return {
    index: cell.index,
    weight: cell.weight,
  }
}

function buildPoint(
  frame: ProbeFrame,
  cell: RasterSampleGeometryCell,
): RasterProbePoint {
  const value = decodeRasterCell(frame, cell.index)
  return {
    x: cell.x,
    y: cell.y,
    lon: frame.raster.grid.lon0 + (cell.x * frame.raster.grid.dx),
    lat: frame.raster.grid.lat0 + (cell.y * frame.raster.grid.dy),
    value,
    weight: cell.weight,
  }
}

function hasExpectedRasterCellCount(frame: ProbeFrame, expectedCellCount: number): boolean {
  return frame.raster.bands.every((band) => band.length === expectedCellCount)
}

function decodeRasterCell(frame: ProbeFrame, index: number): number | null {
  const bandIds = frame.raster.bandIds
  const decoder = RASTER_CELL_DECODERS.find((entry) => hasExactBandIds(bandIds, entry.bandIds))
  return decoder?.decode(frame, index) ?? null
}

function hasExactBandIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((bandId, index) => bandId === expected[index])
}

function decodeScalarRasterCell(frame: ProbeFrame, index: number): number | null {
  return decodeScalarCell(frame.raster.bands[0]?.[index], frame.raster.encoding as ScalarProbeEncoding)
}

function decodeWindSpeedRasterCell(frame: ProbeFrame, index: number): number | null {
  const [uBand, vBand] = frame.raster.bands
  const encoding = frame.raster.encoding as VectorProbeEncoding
  const u = decodeVectorCell(uBand?.[index], encoding)
  const v = decodeVectorCell(vBand?.[index], encoding)
  return u == null || v == null ? null : Math.hypot(u, v)
}

function decodeCloudCoverageRasterCell(frame: ProbeFrame, index: number): number | null {
  const [lowBand, middleBand, highBand] = frame.raster.bands
  const encoding = frame.raster.encoding as VectorProbeEncoding
  const low = decodeVectorCell(lowBand?.[index], encoding)
  const middle = decodeVectorCell(middleBand?.[index], encoding)
  const high = decodeVectorCell(highBand?.[index], encoding)
  if (low == null && middle == null && high == null) return null

  const lowFrac = low == null ? 0 : clamp01(low / 100)
  const middleFrac = middle == null ? 0 : clamp01(middle / 100)
  const highFrac = high == null ? 0 : clamp01(high / 100)
  return (1 - ((1 - lowFrac) * (1 - middleFrac) * (1 - highFrac))) * 100
}

function decodeScalarCell(
  stored: number | undefined,
  encoding: ScalarProbeEncoding
): number | null {
  if (stored == null) return null
  if (encoding.format === 'temp-c-piecewise-i8-v1') {
    if (stored === encoding.nodata) return null
    return decodeTempC(stored)
  }
  if (stored === encoding.nodata) return null
  return (stored * encoding.scale) + encoding.offset
}

function decodeVectorCell(
  stored: number | undefined,
  encoding: VectorProbeEncoding
): number | null {
  if (stored == null) return null
  if (encoding.nodata != null && stored === encoding.nodata) return null
  return (stored * encoding.scale) + encoding.offset
}

function decodeTempC(stored: number): number {
  const idx = stored + 127
  if (idx <= 54) return -35 + (idx * 0.5)
  if (idx <= 222) return -7.75 + ((idx - 55) * 0.25)
  return 34.5 + ((idx - 223) * 0.5)
}

function wrapIndex(value: number, span: number) {
  return Math.floor(wrap(value, span))
}
