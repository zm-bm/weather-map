import { clamp, lerp } from '@/core/math'

export const OVERLAY_MIN_PATTERN_ZOOM = 2
export const OVERLAY_MAX_PATTERN_ZOOM = 6
export const OVERLAY_MIN_PATTERN_TILE_PIXELS = 12
export const OVERLAY_MAX_PATTERN_TILE_PIXELS = 30

export const OVERLAY_MASK_MIN = 0.35
export const OVERLAY_MASK_MAX = 0.65
export const OVERLAY_LATTICE_VISIBILITY_MIN = 0.38
export const OVERLAY_LATTICE_VISIBILITY_MAX = 0.88

export const OVERLAY_SNOW_ALPHA = 0.72
export const OVERLAY_MIX_ALPHA = 0.82
export const OVERLAY_SYMBOL_COLOR_RGB = [0.84, 0.95, 1] as const

export function overlayPatternTilePixelsForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return OVERLAY_MAX_PATTERN_TILE_PIXELS
  const t = clamp(
    (zoom - OVERLAY_MIN_PATTERN_ZOOM) /
      Math.max(1e-6, OVERLAY_MAX_PATTERN_ZOOM - OVERLAY_MIN_PATTERN_ZOOM),
    0,
    1
  )
  return lerp(OVERLAY_MIN_PATTERN_TILE_PIXELS, OVERLAY_MAX_PATTERN_TILE_PIXELS, t)
}
