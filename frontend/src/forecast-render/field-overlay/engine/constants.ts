import { clamp, lerp } from '../../../math'

export const FIELD_OVERLAY_MIN_PATTERN_ZOOM = 2
export const FIELD_OVERLAY_MAX_PATTERN_ZOOM = 6
export const FIELD_OVERLAY_MIN_PATTERN_TILE_PIXELS = 12
export const FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS = 30

export const FIELD_OVERLAY_MASK_MIN = 0.35
export const FIELD_OVERLAY_MASK_MAX = 0.65
export const FIELD_OVERLAY_LATTICE_VISIBILITY_MIN = 0.38
export const FIELD_OVERLAY_LATTICE_VISIBILITY_MAX = 0.88

export const FIELD_OVERLAY_SNOW_ALPHA = 0.72
export const FIELD_OVERLAY_MIX_ALPHA = 0.82
export const FIELD_OVERLAY_SYMBOL_COLOR_RGB = [0.84, 0.95, 1] as const

export function fieldOverlayPatternTilePixelsForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS
  const t = clamp(
    (zoom - FIELD_OVERLAY_MIN_PATTERN_ZOOM) /
      Math.max(1e-6, FIELD_OVERLAY_MAX_PATTERN_ZOOM - FIELD_OVERLAY_MIN_PATTERN_ZOOM),
    0,
    1
  )
  return lerp(FIELD_OVERLAY_MIN_PATTERN_TILE_PIXELS, FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS, t)
}
