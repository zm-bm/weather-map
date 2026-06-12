import type { GridSpec } from '@/forecast/manifest'

export const GRID_X_WRAP_NONE = 0
export const GRID_X_WRAP_REPEAT = 1
export const GRID_Y_MODE_NONE = 0
export const GRID_Y_MODE_CLAMP = 1

const GLOBAL_LON_SPAN_DEGREES = 360
const GLOBAL_LAT_SPAN_DEGREES = 180
const GLOBAL_SPAN_TOLERANCE_DEGREES = 1
const GLOBAL_POLE_EDGE_TOLERANCE_DEGREES = 1

export type EffectiveGridBoundaryModes = {
  xWrap: 'none' | 'repeat'
  yMode: 'none' | 'clamp'
  xWrapUniform: number
  yModeUniform: number
}

export function effectiveGridBoundaryModes(grid: GridSpec): EffectiveGridBoundaryModes {
  const xWrap = grid.x_wrap === 'repeat' && isGlobalLongitudeGrid(grid) ? 'repeat' : 'none'
  const yMode = grid.y_mode === 'clamp' && isGlobalLatitudeGrid(grid) ? 'clamp' : 'none'
  return {
    xWrap,
    yMode,
    xWrapUniform: xWrap === 'repeat' ? GRID_X_WRAP_REPEAT : GRID_X_WRAP_NONE,
    yModeUniform: yMode === 'clamp' ? GRID_Y_MODE_CLAMP : GRID_Y_MODE_NONE,
  }
}

export function gridCoordIsInsideDomain(args: {
  grid: GridSpec
  gridX: number
  gridY: number
}): boolean {
  const modes = effectiveGridBoundaryModes(args.grid)
  return (
    modes.xWrap === 'repeat' || isCoordInsideCellEdges(args.gridX, args.grid.nx)
  ) && (
    modes.yMode === 'clamp' || isCoordInsideCellEdges(args.gridY, args.grid.ny)
  )
}

function isGlobalLongitudeGrid(grid: GridSpec): boolean {
  return near(absSpan(grid.dx, grid.nx), GLOBAL_LON_SPAN_DEGREES)
}

function isGlobalLatitudeGrid(grid: GridSpec): boolean {
  if (!near(absSpan(grid.dy, grid.ny), GLOBAL_LAT_SPAN_DEGREES)) return false
  const firstEdge = grid.lat0 - (0.5 * grid.dy)
  const lastEdge = grid.lat0 + (grid.dy * (grid.ny - 1)) + (0.5 * grid.dy)
  const north = Math.max(firstEdge, lastEdge)
  const south = Math.min(firstEdge, lastEdge)
  return north >= 90 - GLOBAL_POLE_EDGE_TOLERANCE_DEGREES &&
    south <= -90 + GLOBAL_POLE_EDGE_TOLERANCE_DEGREES
}

function isCoordInsideCellEdges(coord: number, span: number): boolean {
  return coord >= -0.5 && coord <= span - 0.5
}

function absSpan(step: number, count: number): number {
  return Math.abs(step) * count
}

function near(value: number, target: number): boolean {
  return Number.isFinite(value) && Math.abs(value - target) <= GLOBAL_SPAN_TOLERANCE_DEGREES
}
