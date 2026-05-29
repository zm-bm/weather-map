import { describe, expect, it } from 'vitest'

import { buildInitialParticleState, PARTICLE_STATE_COMPONENTS } from './stateBuffers'

describe('particle state buffer helpers', () => {
  it('seeds lon, lat, age, and zero speed for each particle', () => {
    const data = buildInitialParticleState(3, {
      west: -10,
      east: 10,
      south: 30,
      north: 40,
    }, 60)

    expect(data.length).toBe(3 * PARTICLE_STATE_COMPONENTS)
    for (let i = 0; i < 3; i += 1) {
      const base = i * PARTICLE_STATE_COMPONENTS
      expect(data[base]).toBeGreaterThanOrEqual(-10)
      expect(data[base]).toBeLessThanOrEqual(10)
      expect(data[base + 1]).toBeGreaterThanOrEqual(30)
      expect(data[base + 1]).toBeLessThanOrEqual(40)
      expect(data[base + 2]).toBeGreaterThanOrEqual(0)
      expect(data[base + 2]).toBeLessThanOrEqual(60)
      expect(data[base + 3]).toBe(0)
    }
  })

  it('returns zeroed state when no viewport is available', () => {
    expect(Array.from(buildInitialParticleState(2, null, 60))).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
    ])
  })
})
