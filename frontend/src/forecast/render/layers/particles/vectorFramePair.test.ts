import { describe, expect, it, vi } from 'vitest'

import {
  createParticlesWindowFixture,
} from '@/test/fixtures'
import {
  createVectorFramePair,
  vectorFramePairSignature,
} from './vectorFramePair'

describe('particle vector frame pair helpers', () => {
  it('stores lower and upper wind frames with a time mix', () => {
    const lower = createParticlesWindowFixture().lower
    const upper = { ...lower, raster: { ...lower.raster, frameId: '001', cacheKey: 'fixture:wind:001' } }
    const frame = {
      ...createParticlesWindowFixture(),
      lower,
      upper,
      mix: 0.5,
    }

    const pair = createVectorFramePair(frame)

    expect(pair).toMatchObject({
      lowerFrame: frame.lower,
      upperFrame: frame.upper,
      timeMix: 0.5,
    })
  })

  it('collapses zero-mix windows to a single frame', () => {
    const frame = {
      ...createParticlesWindowFixture(),
      mix: 0,
    }

    const pair = createVectorFramePair(frame)

    expect(pair).toMatchObject({
      lowerFrame: frame.lower,
      upperFrame: frame.lower,
      timeMix: 0,
    })
  })

  it('exposes a stable signature for frame-change checks', () => {
    const lower = createParticlesWindowFixture().lower
    const upper = { ...lower, raster: { ...lower.raster, frameId: '002', cacheKey: 'fixture:wind:002' } }
    const pair = createVectorFramePair({
      lower,
      upper,
      selectedValidTimeMs: 0,
      lowerFrameId: lower.raster.frameId,
      upperFrameId: upper.raster.frameId,
      mix: 0.5,
    })
    if (!pair) throw new Error('Expected vector frame pair')

    expect(vectorFramePairSignature(pair)).toBe('wind10m_uv:000:002')
  })

  it('warns and skips frame pair creation when loaded bands do not match the source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = createParticlesWindowFixture()
    const lower = {
      ...frame.lower,
      raster: {
        ...frame.lower.raster,
        bandIds: ['speed'],
      },
    }

    const pair = createVectorFramePair({
      ...frame,
      lower,
      upper: lower,
    })

    expect(pair).toBeNull()
    expect(warn).toHaveBeenCalledWith('[particles] particles vector requires bands u, v; got speed')
    warn.mockRestore()
  })
})
