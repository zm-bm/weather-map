import { describe, expect, it } from 'vitest'

import {
  FIELD_OVERLAY_PATTERN_FADE_IN_MS,
  FIELD_OVERLAY_PATTERN_FADE_OUT_MS,
  precipTypeOverlayPatternWeights,
  stepPatternOpacity,
} from './runtime'
import {
  FIELD_OVERLAY_MIX_ALPHA,
  FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS,
  FIELD_OVERLAY_MAX_PATTERN_ZOOM,
  FIELD_OVERLAY_MIN_PATTERN_TILE_PIXELS,
  FIELD_OVERLAY_MIN_PATTERN_ZOOM,
  FIELD_OVERLAY_SNOW_ALPHA,
  fieldOverlayPatternTilePixelsForZoom,
} from './constants'

describe('field overlay runtime helpers', () => {
  it('scales pattern tile size from z2 to z6 and clamps outside that range', () => {
    expect(FIELD_OVERLAY_MIN_PATTERN_ZOOM).toBe(2)
    expect(FIELD_OVERLAY_MAX_PATTERN_ZOOM).toBe(6)
    expect(FIELD_OVERLAY_MIN_PATTERN_TILE_PIXELS).toBe(12)
    expect(FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS).toBe(30)
    expect(fieldOverlayPatternTilePixelsForZoom(1)).toBeCloseTo(12)
    expect(fieldOverlayPatternTilePixelsForZoom(2)).toBeCloseTo(12)
    expect(fieldOverlayPatternTilePixelsForZoom(4)).toBeGreaterThan(12)
    expect(fieldOverlayPatternTilePixelsForZoom(4)).toBeLessThan(30)
    expect(fieldOverlayPatternTilePixelsForZoom(6)).toBeCloseTo(30)
    expect(fieldOverlayPatternTilePixelsForZoom(7)).toBeCloseTo(30)
  })

  it('steps pattern opacity down and up with separate fade timings', () => {
    const halfFadeOut = stepPatternOpacity({
      opacity: 1,
      target: 0,
      elapsedMs: FIELD_OVERLAY_PATTERN_FADE_OUT_MS / 2,
    })
    expect(halfFadeOut.opacity).toBeCloseTo(0.5)
    expect(halfFadeOut.needsRepaint).toBe(true)

    expect(stepPatternOpacity({
      opacity: 0.5,
      target: 0,
      elapsedMs: FIELD_OVERLAY_PATTERN_FADE_OUT_MS,
    })).toEqual({
      opacity: 0,
      needsRepaint: false,
    })

    const halfFadeIn = stepPatternOpacity({
      opacity: 0,
      target: 1,
      elapsedMs: FIELD_OVERLAY_PATTERN_FADE_IN_MS / 2,
    })
    expect(halfFadeIn.opacity).toBeCloseTo(0.5)
    expect(halfFadeIn.needsRepaint).toBe(true)
  })

  it('clamps pattern opacity inputs and settles without repainting at the target', () => {
    expect(stepPatternOpacity({
      opacity: 1.4,
      target: -0.5,
      elapsedMs: FIELD_OVERLAY_PATTERN_FADE_OUT_MS,
    })).toEqual({
      opacity: 0,
      needsRepaint: false,
    })

    expect(stepPatternOpacity({
      opacity: 1,
      target: 1,
      elapsedMs: 0,
    })).toEqual({
      opacity: 1,
      needsRepaint: false,
    })
  })

  it('uses soft masks and pattern weights for snow and mix', () => {
    expect(precipTypeOverlayPatternWeights({ snowFrac: 0.2, mixFrac: 0 })).toEqual({
      snowMask: 0,
      mixMask: 0,
      snowLatticeVisibility: 0,
      mixLatticeVisibility: 0,
      snowAlphaWeight: 0,
      mixAlphaWeight: 0,
    })

    const snow = precipTypeOverlayPatternWeights({ snowFrac: 0.8, mixFrac: 0 })
    expect(snow.snowMask).toBeCloseTo(1)
    expect(snow.mixMask).toBe(0)
    expect(snow.snowLatticeVisibility).toBeGreaterThan(0)
    expect(snow.snowAlphaWeight).toBeCloseTo(FIELD_OVERLAY_SNOW_ALPHA)
    expect(snow.mixAlphaWeight).toBe(0)

    const mix = precipTypeOverlayPatternWeights({ snowFrac: 1, mixFrac: 1 })
    expect(mix.snowMask).toBeCloseTo(0)
    expect(mix.mixMask).toBeCloseTo(1)
    expect(mix.snowLatticeVisibility).toBeCloseTo(0)
    expect(mix.mixLatticeVisibility).toBeCloseTo(1)
    expect(mix.snowAlphaWeight).toBeCloseTo(0)
    expect(mix.mixAlphaWeight).toBeCloseTo(FIELD_OVERLAY_MIX_ALPHA)
  })

  it('increases lattice visibility at high fractions and treats non-finite values as zero', () => {
    const moderateSnow = precipTypeOverlayPatternWeights({ snowFrac: 0.68, mixFrac: 0 })
    const heavySnow = precipTypeOverlayPatternWeights({ snowFrac: 0.95, mixFrac: 0 })
    const moderateMix = precipTypeOverlayPatternWeights({ snowFrac: 0, mixFrac: 0.68 })
    const heavyMix = precipTypeOverlayPatternWeights({ snowFrac: 0, mixFrac: 0.95 })

    expect(moderateSnow.snowLatticeVisibility).toBeGreaterThan(0)
    expect(moderateSnow.snowLatticeVisibility).toBeLessThan(heavySnow.snowLatticeVisibility)
    expect(heavySnow.snowLatticeVisibility).toBeCloseTo(1)
    expect(heavySnow.snowAlphaWeight).toBeCloseTo(moderateSnow.snowAlphaWeight)
    expect(moderateMix.mixLatticeVisibility).toBeGreaterThan(0)
    expect(moderateMix.mixLatticeVisibility).toBeLessThan(heavyMix.mixLatticeVisibility)
    expect(heavyMix.mixLatticeVisibility).toBeCloseTo(1)

    expect(precipTypeOverlayPatternWeights({ snowFrac: Number.NaN, mixFrac: Infinity })).toEqual({
      snowMask: 0,
      mixMask: 0,
      snowLatticeVisibility: 0,
      mixLatticeVisibility: 0,
      snowAlphaWeight: 0,
      mixAlphaWeight: 0,
    })
  })
})
