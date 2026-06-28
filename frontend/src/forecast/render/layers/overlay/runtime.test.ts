import { describe, expect, it, vi } from 'vitest'

import {
  createOverlayFrameFixture,
  createOverlayWindowFixture,
  createCustomRenderInputFixture,
  createMockWebGl2,
} from '@/test/fixtures'
import { createRenderControllerRegistry } from '../../maplibre/layerAdapter'
import {
  createOverlayRuntime,
  type OverlayController,
} from './runtime'
import {
  OVERLAY_PATTERN_FADE_IN_MS,
  OVERLAY_PATTERN_FADE_OUT_MS,
  precipTypeOverlayPatternWeights,
  stepPatternOpacity,
  OVERLAY_MIX_ALPHA,
  OVERLAY_MAX_PATTERN_TILE_PIXELS,
  OVERLAY_MAX_PATTERN_ZOOM,
  OVERLAY_MIN_PATTERN_TILE_PIXELS,
  OVERLAY_MIN_PATTERN_ZOOM,
  OVERLAY_SNOW_ALPHA,
  overlayPatternTilePixelsForZoom,
} from './renderPaths/precipitationType'
import { OVERLAY_FRAGMENT_SHADER_SOURCE } from './shaders'

describe('overlay runtime helpers', () => {
  it('uses standard encoded texture uniforms in the overlay shader', () => {
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_lower')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_upper')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('sampleLinearClampedTemporalLayer')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).not.toContain('u_precip_tex')
  })

  it('clips precipitation glyphs outside the visible globe hemisphere', () => {
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('uniform highp vec4 u_projection_clipping_plane')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('uniform highp float u_projection_transition')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('bool globeFragmentOutsideVisibleHemisphere(vec2 mercator)')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('if (globeFragmentOutsideVisibleHemisphere(v_mercator))')
    expect(OVERLAY_FRAGMENT_SHADER_SOURCE).toContain('discard;')
  })

  it('scales pattern tile size from z2 to z6 and clamps outside that range', () => {
    expect(OVERLAY_MIN_PATTERN_ZOOM).toBe(2)
    expect(OVERLAY_MAX_PATTERN_ZOOM).toBe(6)
    expect(OVERLAY_MIN_PATTERN_TILE_PIXELS).toBe(12)
    expect(OVERLAY_MAX_PATTERN_TILE_PIXELS).toBe(30)
    expect(overlayPatternTilePixelsForZoom(1)).toBeCloseTo(12)
    expect(overlayPatternTilePixelsForZoom(2)).toBeCloseTo(12)
    expect(overlayPatternTilePixelsForZoom(4)).toBeGreaterThan(12)
    expect(overlayPatternTilePixelsForZoom(4)).toBeLessThan(30)
    expect(overlayPatternTilePixelsForZoom(6)).toBeCloseTo(30)
    expect(overlayPatternTilePixelsForZoom(7)).toBeCloseTo(30)
  })

  it('steps pattern opacity down and up with separate fade timings', () => {
    const halfFadeOut = stepPatternOpacity({
      opacity: 1,
      target: 0,
      elapsedMs: OVERLAY_PATTERN_FADE_OUT_MS / 2,
    })
    expect(halfFadeOut.opacity).toBeCloseTo(0.5)
    expect(halfFadeOut.needsRepaint).toBe(true)

    expect(stepPatternOpacity({
      opacity: 0.5,
      target: 0,
      elapsedMs: OVERLAY_PATTERN_FADE_OUT_MS,
    })).toEqual({
      opacity: 0,
      needsRepaint: false,
    })

    const halfFadeIn = stepPatternOpacity({
      opacity: 0,
      target: 1,
      elapsedMs: OVERLAY_PATTERN_FADE_IN_MS / 2,
    })
    expect(halfFadeIn.opacity).toBeCloseTo(0.5)
    expect(halfFadeIn.needsRepaint).toBe(true)
  })

  it('clamps pattern opacity inputs and settles without repainting at the target', () => {
    expect(stepPatternOpacity({
      opacity: 1.4,
      target: -0.5,
      elapsedMs: OVERLAY_PATTERN_FADE_OUT_MS,
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
    expect(snow.snowAlphaWeight).toBeCloseTo(OVERLAY_SNOW_ALPHA)
    expect(snow.mixAlphaWeight).toBe(0)

    const mix = precipTypeOverlayPatternWeights({ snowFrac: 1, mixFrac: 1 })
    expect(mix.snowMask).toBeCloseTo(0)
    expect(mix.mixMask).toBeCloseTo(1)
    expect(mix.snowLatticeVisibility).toBeCloseTo(0)
    expect(mix.mixLatticeVisibility).toBeCloseTo(1)
    expect(mix.snowAlphaWeight).toBeCloseTo(0)
    expect(mix.mixAlphaWeight).toBeCloseTo(OVERLAY_MIX_ALPHA)
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

  it('uploads precip type frames as cached two-band signed integer texture arrays', () => {
    const controllers = createRenderControllerRegistry<OverlayController>()
    const runtime = createOverlayRuntime(controllers)
    const gl = createMockWebGl2()
    const map = {
      getZoom: vi.fn(() => 4.25),
      getCenter: vi.fn(() => ({ lng: 0 })),
      triggerRepaint: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const frame = createOverlayWindowFixture()
    const lowerOverlay = frame.lower[0]
    if (!lowerOverlay) throw new Error('Expected overlay fixture')

    runtime.onAdd(map as never, gl as never)
    const controller = controllers.get(map as never)
    controller?.applyFrame(frame)
    controller?.applyFrame(frame)
    runtime.render(gl as never, createCustomRenderInputFixture() as never)

    expect(gl.texImage3D).toHaveBeenCalledTimes(1)
    expect(gl.texImage3D).toHaveBeenCalledWith(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      lowerOverlay.raster.grid.nx,
      lowerOverlay.raster.grid.ny,
      2,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      expect.any(Int8Array)
    )
    expect(gl.uniform1i).toHaveBeenCalledWith('u_encoded_tex_lower', expect.any(Number))
    expect(gl.uniform1i).toHaveBeenCalledWith('u_encoded_tex_upper', expect.any(Number))

    runtime.onRemove(map as never, gl as never)
  })

  it('skips drawing after null or empty overlay frames clear entries', () => {
    const controllers = createRenderControllerRegistry<OverlayController>()
    const runtime = createOverlayRuntime(controllers)
    const gl = createMockWebGl2()
    const map = {
      getZoom: vi.fn(() => 4.25),
      getCenter: vi.fn(() => ({ lng: 0 })),
      triggerRepaint: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const renderInput = createCustomRenderInputFixture()

    runtime.onAdd(map as never, gl as never)
    const controller = controllers.get(map as never)
    controller?.applyFrame(createOverlayWindowFixture())

    gl.drawArrays.mockClear()
    controller?.applyFrame(null)
    runtime.render(gl as never, renderInput as never)
    expect(gl.drawArrays).not.toHaveBeenCalled()

    controller?.applyFrame(createOverlayWindowFixture({
      lower: createOverlayFrameFixture({ overlays: [] }),
      upper: createOverlayFrameFixture({ overlays: [] }),
    }))
    runtime.render(gl as never, renderInput as never)
    expect(gl.drawArrays).not.toHaveBeenCalled()

    runtime.onRemove(map as never, gl as never)
  })
})
