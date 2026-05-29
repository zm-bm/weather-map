import { describe, expect, it } from 'vitest'

import { DEFAULT_PARTICLE_RENDER_SETTINGS } from '@/forecast/settings/settings'
import { createMockWebGl2 } from '@/test/fixtures'
import {
  clearTrailTextures,
  createEmptyParticleTrailTargets,
  disposeTrailTargets,
  ensureTrailTargets,
  initializeTrailTargets,
} from './trailTargets'

describe('particle trail target helpers', () => {
  it('allocates, clears, resizes, and disposes trail targets', () => {
    const gl = createMockWebGl2() as ReturnType<typeof createMockWebGl2> & {
      drawingBufferWidth: number
      drawingBufferHeight: number
    }
    gl.drawingBufferWidth = 100
    gl.drawingBufferHeight = 50
    const targets = createEmptyParticleTrailTargets()

    expect(initializeTrailTargets(gl as never, targets)).toBe(true)
    expect(ensureTrailTargets(gl as never, targets, {
      ...DEFAULT_PARTICLE_RENDER_SETTINGS,
      trailScale: 0.5,
    })).toBe(true)

    expect(targets.trailWidth).toBe(50)
    expect(targets.trailHeight).toBe(25)
    clearTrailTextures(gl as never, targets)
    expect(gl.clearBufferfv).toHaveBeenCalled()

    disposeTrailTargets(gl as never, targets)
    expect(gl.deleteFramebuffer).toHaveBeenCalled()
    expect(gl.deleteTexture).toHaveBeenCalled()
    expect(targets.trailFramebuffer).toBeNull()
    expect(targets.trailTextures).toEqual([null, null])
  })
})
