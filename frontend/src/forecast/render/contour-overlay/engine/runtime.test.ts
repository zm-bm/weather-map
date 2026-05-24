import { describe, expect, it } from 'vitest'

import {
  PRESSURE_CONTOUR_HALO_ALPHA,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAIN_ALPHA,
} from '../constants'
import {
  interpolatePressureHpa,
  pressureContourPhaseBandWeights,
  pressureContourPhaseDistanceHpa,
  smoothPressureHpa3x3,
} from './runtime'

describe('pressure contour runtime helpers', () => {
  it('computes distance to the nearest 4 hPa contour interval', () => {
    expect(PRESSURE_CONTOUR_INTERVAL_HPA).toBe(4)
    expect(pressureContourPhaseDistanceHpa(1000)).toBe(0)
    expect(pressureContourPhaseDistanceHpa(1002)).toBe(2)
    expect(pressureContourPhaseDistanceHpa(1003.5)).toBeCloseTo(0.5)
  })

  it('preserves a flat field through the 3x3 smoothing kernel', () => {
    expect(smoothPressureHpa3x3([
      1000, 1000, 1000,
      1000, 1000, 1000,
      1000, 1000, 1000,
    ])).toBe(1000)
  })

  it('reduces a single-cell pressure spike', () => {
    const smoothedPressure = smoothPressureHpa3x3([
      1000, 1000, 1000,
      1000, 1008, 1000,
      1000, 1000, 1000,
    ])

    expect(smoothedPressure).toBeCloseTo(1002)
    expect(smoothedPressure).toBeGreaterThan(1000)
    expect(smoothedPressure).toBeLessThan(1008)
  })

  it('normalizes smoothing weights over valid neighbors only', () => {
    expect(smoothPressureHpa3x3([
      Number.NaN, 1002, Number.NaN,
      1002, 1002, 1002,
      Number.NaN, 1002, Number.NaN,
    ])).toBe(1002)
  })

  it('requires a valid center pressure sample before smoothing', () => {
    expect(smoothPressureHpa3x3([
      1000, 1000, 1000,
      1000, Number.NaN, 1000,
      1000, 1000, 1000,
    ])).toBeNaN()
    expect(smoothPressureHpa3x3([
      Number.NaN, Number.NaN, Number.NaN,
      Number.NaN, Number.NaN, Number.NaN,
      Number.NaN, Number.NaN, Number.NaN,
    ])).toBeNaN()
  })

  it('produces softened white main alpha near a contour with a faint halo', () => {
    const weights = pressureContourPhaseBandWeights({
      pressureHpa: 1000,
      pressureDerivativeHpa: 1,
    })

    expect(weights.mainAlpha).toBeCloseTo(PRESSURE_CONTOUR_MAIN_ALPHA)
    expect(weights.haloAlpha).toBeCloseTo(PRESSURE_CONTOUR_HALO_ALPHA)
  })

  it('fades to zero away from a contour', () => {
    const weights = pressureContourPhaseBandWeights({
      pressureHpa: 1002,
      pressureDerivativeHpa: 0.1,
    })

    expect(weights.mainAlpha).toBe(0)
    expect(weights.haloAlpha).toBe(0)
  })

  it('treats non-finite pressure or flat pressure derivative as no contour', () => {
    expect(pressureContourPhaseBandWeights({
      pressureHpa: Number.NaN,
      pressureDerivativeHpa: 1,
    })).toEqual({ mainAlpha: 0, haloAlpha: 0 })
    expect(pressureContourPhaseBandWeights({
      pressureHpa: 1000,
      pressureDerivativeHpa: 0,
    })).toEqual({ mainAlpha: 0, haloAlpha: 0 })
  })

  it('interpolates lower and upper smoothed pressure before contour styling', () => {
    const lowerHpa = smoothPressureHpa3x3([
      998, 998, 998,
      998, 998, 998,
      998, 998, 998,
    ])
    const upperHpa = smoothPressureHpa3x3([
      1002, 1002, 1002,
      1002, 1002, 1002,
      1002, 1002, 1002,
    ])
    const pressureHpa = interpolatePressureHpa({
      lowerHpa,
      upperHpa,
      mix: 0.5,
    })
    const weights = pressureContourPhaseBandWeights({
      pressureHpa,
      pressureDerivativeHpa: 1,
    })

    expect(pressureHpa).toBe(1000)
    expect(weights.mainAlpha).toBeCloseTo(PRESSURE_CONTOUR_MAIN_ALPHA)
  })

  it('falls back to the finite pressure side when only one frame has data', () => {
    expect(interpolatePressureHpa({
      lowerHpa: Number.NaN,
      upperHpa: 1004,
      mix: 0.5,
    })).toBe(1004)
    expect(interpolatePressureHpa({
      lowerHpa: 996,
      upperHpa: Number.NaN,
      mix: 0.5,
    })).toBe(996)
    expect(interpolatePressureHpa({
      lowerHpa: Number.NaN,
      upperHpa: Number.NaN,
      mix: 0.5,
    })).toBeNaN()
  })
})
