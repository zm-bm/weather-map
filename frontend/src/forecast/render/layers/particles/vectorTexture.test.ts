import { describe, expect, it, vi } from 'vitest'

import {
  createMockWebGl2,
  createParticlesWindowFixture,
} from '@/test/fixtures'
import {
  createPackedVectorFramePair,
  deletePackedVectorFramePairTextures,
} from './vectorTexture'

describe('particle vector texture helpers', () => {
  it('uploads wind vectors as signed interleaved RG8I textures', () => {
    const gl = createMockWebGl2()
    const frame = createParticlesWindowFixture()

    const pair = createPackedVectorFramePair(gl as never, frame, null)

    expect(pair).not.toBeNull()
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RG8I,
      frame.lower.raster.grid.nx,
      frame.lower.raster.grid.ny,
      0,
      gl.RG_INTEGER,
      gl.BYTE,
      new Int8Array([1, -1, 2, -2, 3, -3, 4, -4]),
    )
  })

  it('reuses lower-to-upper textures across vector frame transitions', () => {
    const gl = createMockWebGl2()
    let textureId = 0
    gl.createTexture.mockImplementation(() => ({ id: textureId += 1 }))
    const lower = createParticlesWindowFixture().lower
    const middle = { ...lower, raster: { ...lower.raster, hourToken: '001', cacheKey: 'fixture:wind:001' } }
    const upper = { ...lower, raster: { ...lower.raster, hourToken: '002', cacheKey: 'fixture:wind:002' } }
    const first = createPackedVectorFramePair(
      gl as never,
      {
        lower,
        upper: middle,
        selectedValidTimeMs: 0,
        lowerHourToken: lower.raster.hourToken,
        upperHourToken: middle.raster.hourToken,
        mix: 0.5,
      },
      null,
    )
    if (!first) throw new Error('Expected first vector frame pair')

    const second = createPackedVectorFramePair(
      gl as never,
      {
        lower: middle,
        upper,
        selectedValidTimeMs: 0,
        lowerHourToken: middle.raster.hourToken,
        upperHourToken: upper.raster.hourToken,
        mix: 0.5,
      },
      first,
    )
    if (!second) throw new Error('Expected second vector frame pair')
    deletePackedVectorFramePairTextures(gl as never, first, second)

    expect(gl.texImage2D).toHaveBeenCalledTimes(3)
    expect(second.lowerTexture).toBe(first.upperTexture)
    expect(gl.deleteTexture).toHaveBeenCalledWith(first.lowerTexture)
    expect(gl.deleteTexture).not.toHaveBeenCalledWith(first.upperTexture)
  })

  it('warns and skips vector texture creation when loaded bands do not match the source', () => {
    const gl = createMockWebGl2()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = createParticlesWindowFixture()
    const lower = {
      ...frame.lower,
      raster: {
        ...frame.lower.raster,
        bandIds: ['speed'],
      },
    }

    const pair = createPackedVectorFramePair(gl as never, {
      ...frame,
      lower,
      upper: lower,
    }, null)

    expect(pair).toBeNull()
    expect(warn).toHaveBeenCalledWith('[particles] particles vector requires bands u, v; got speed')
    warn.mockRestore()
  })
})
