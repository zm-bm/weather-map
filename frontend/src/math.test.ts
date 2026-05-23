import { describe, expect, it } from 'vitest'

import {
  clamp,
  clamp01,
  lerp,
  roughlyEqual,
  smoothstep,
  wrap,
} from './math'

describe('math helpers', () => {
  it('clamps values below, inside, and above a range', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(4, 0, 10)).toBe(4)
    expect(clamp(12, 0, 10)).toBe(10)
  })

  it('clamps values to a normalized fraction', () => {
    expect(clamp01(-0.25)).toBe(0)
    expect(clamp01(0.75)).toBe(0.75)
    expect(clamp01(1.25)).toBe(1)
  })

  it('linearly interpolates between endpoints', () => {
    expect(lerp(10, 20, 0)).toBe(10)
    expect(lerp(10, 20, 0.5)).toBe(15)
    expect(lerp(10, 20, 1)).toBe(20)
  })

  it('wraps positive and negative values into a positive span', () => {
    expect(wrap(7, 5)).toBe(2)
    expect(wrap(-1, 5)).toBe(4)
    expect(wrap(3, 0)).toBe(3)
  })

  it('smoothsteps across the clamped edge range', () => {
    expect(smoothstep(0, 10, -5)).toBe(0)
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5)
    expect(smoothstep(0, 10, 15)).toBe(1)
  })

  it('compares numbers with default and custom epsilon', () => {
    expect(roughlyEqual(1, 1 + 5e-7)).toBe(true)
    expect(roughlyEqual(1, 1 + 5e-5)).toBe(false)
    expect(roughlyEqual(1, 1.01, 0.02)).toBe(true)
  })
})
