import { describe, expect, it } from 'vitest'

import {
  PRESSURE_CONTOUR_EDGE_EPSILON_HPA,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAX_LEVELS_PER_CELL,
  PRESSURE_CONTOUR_MIN_COVERAGE,
  interpolatePressureField,
  isPressureFieldContourable,
  pressureContourLevelsForCell,
  pressureMarchingSquareSegmentCount,
  pressureMarchingSquareSaddlePairing,
  smoothPressureField3x3,
} from './pressure'

describe('pressure contour math helpers', () => {
  it('keeps pressure contours on 4 hPa intervals', () => {
    expect(PRESSURE_CONTOUR_INTERVAL_HPA).toBe(4)
    expect(PRESSURE_CONTOUR_EDGE_EPSILON_HPA).toBe(1e-4)
    expect(PRESSURE_CONTOUR_MAX_LEVELS_PER_CELL).toBe(32)
    expect(PRESSURE_CONTOUR_MIN_COVERAGE).toBe(0.875)
  })

  it('preserves a flat field through the 3x3 smoothing kernel', () => {
    const sample = smoothPressureField3x3([
      1000, 1000, 1000,
      1000, 1000, 1000,
      1000, 1000, 1000,
    ])

    expect(sample.pressureHpa).toBe(1000)
    expect(sample.coverage).toBe(1)
    expect(isPressureFieldContourable(sample)).toBe(true)
  })

  it('reduces a single-cell pressure spike', () => {
    const smoothedPressure = smoothPressureField3x3([
      1000, 1000, 1000,
      1000, 1008, 1000,
      1000, 1000, 1000,
    ])

    expect(smoothedPressure.pressureHpa).toBeCloseTo(1002)
    expect(smoothedPressure.pressureHpa).toBeGreaterThan(1000)
    expect(smoothedPressure.pressureHpa).toBeLessThan(1008)
    expect(smoothedPressure.coverage).toBe(1)
  })

  it('tracks partial smoothing coverage below the contour threshold', () => {
    const sample = smoothPressureField3x3([
      Number.NaN, 1002, Number.NaN,
      1002, 1002, 1002,
      Number.NaN, 1002, Number.NaN,
    ])

    expect(sample.pressureHpa).toBe(1002)
    expect(sample.coverage).toBe(0.75)
    expect(sample.coverage).toBeLessThan(PRESSURE_CONTOUR_MIN_COVERAGE)
    expect(isPressureFieldContourable(sample)).toBe(false)
  })

  it('accepts cells missing only low-weight smoothing support', () => {
    const sample = smoothPressureField3x3([
      Number.NaN, 1002, 1002,
      1002, 1002, 1002,
      1002, 1002, 1002,
    ])

    expect(sample.pressureHpa).toBe(1002)
    expect(sample.coverage).toBe(0.9375)
    expect(isPressureFieldContourable(sample)).toBe(true)
  })

  it('requires a valid center pressure sample before smoothing', () => {
    const centerMissing = smoothPressureField3x3([
      1000, 1000, 1000,
      1000, Number.NaN, 1000,
      1000, 1000, 1000,
    ])
    const allMissing = smoothPressureField3x3([
      Number.NaN, Number.NaN, Number.NaN,
      Number.NaN, Number.NaN, Number.NaN,
      Number.NaN, Number.NaN, Number.NaN,
    ])

    expect(centerMissing.pressureHpa).toBeNaN()
    expect(centerMissing.coverage).toBe(0)
    expect(isPressureFieldContourable(centerMissing)).toBe(false)
    expect(allMissing.pressureHpa).toBeNaN()
    expect(allMissing.coverage).toBe(0)
    expect(isPressureFieldContourable(allMissing)).toBe(false)
  })

  it('does not contour flat pressure cells', () => {
    expect(pressureMarchingSquareSegmentCount([1000, 1000, 1000, 1000], 1000)).toBe(0)
    expect(pressureMarchingSquareSegmentCount([1002, 1002, 1002, 1002], 1000)).toBe(0)
  })

  it('selects contour levels from the whole pressure cell range', () => {
    expect(pressureContourLevelsForCell([999, 1009, 1001, 1003])).toEqual([1000, 1004, 1008])
    expect(pressureContourLevelsForCell([1000, 1002, 1000, 1002])).toEqual([1000])
    expect(pressureContourLevelsForCell([1000, 1000, 1000, 1000])).toEqual([])
  })

  it('counts one segment for a cell that crosses a contour level once', () => {
    expect(pressureMarchingSquareSegmentCount([999, 1001, 999, 1001], 1000)).toBe(1)
  })

  it('keeps contours connected when one corner is exactly on the contour level', () => {
    expect(pressureMarchingSquareSegmentCount([1000, 1001, 999, 1001], 1000)).toBe(1)
  })

  it('counts two segments for a saddle cell', () => {
    expect(pressureMarchingSquareSegmentCount([999, 1001, 1001, 999], 1000)).toBe(2)
  })

  it('chooses saddle pairings from the center pressure value', () => {
    expect(pressureMarchingSquareSaddlePairing([1001, 999, 999, 1001], 1000))
      .toBe('bottom-right/top-left')
    expect(pressureMarchingSquareSaddlePairing([999, 1001, 1001, 999], 1000))
      .toBe('bottom-left/right-top')
    expect(pressureMarchingSquareSaddlePairing([998, 1001, 1001, 998], 1000))
      .toBe('bottom-right/top-left')
  })

  it('rejects invalid pressure cells before marching squares', () => {
    expect(pressureMarchingSquareSegmentCount([999, Number.NaN, 1001, 1001], 1000)).toBe(0)
    expect(pressureMarchingSquareSegmentCount([999, 1001, 1001, 999], Number.NaN)).toBe(0)
    expect(pressureContourLevelsForCell([999, Number.NaN, 1001, 1001])).toEqual([])
  })

  it('interpolates lower and upper smoothed pressure before contouring', () => {
    const lower = smoothPressureField3x3([
      998, 998, 998,
      998, 998, 998,
      998, 998, 998,
    ])
    const upper = smoothPressureField3x3([
      1002, 1002, 1002,
      1002, 1002, 1002,
      1002, 1002, 1002,
    ])
    const pressure = interpolatePressureField({
      lower,
      upper,
      mix: 0.5,
    })

    expect(pressure.pressureHpa).toBe(1000)
    expect(pressure.coverage).toBe(1)
  })

  it('requires both frames for intermediate temporal interpolation', () => {
    const lower = { pressureHpa: 996, coverage: 1 }
    const upper = { pressureHpa: 1004, coverage: 1 }
    const missing = { pressureHpa: Number.NaN, coverage: 0 }

    expect(interpolatePressureField({ lower: missing, upper, mix: 0.5 }).pressureHpa)
      .toBeNaN()
    expect(interpolatePressureField({ lower, upper: missing, mix: 0.5 }).pressureHpa)
      .toBeNaN()
    expect(interpolatePressureField({ lower: missing, upper, mix: 1 })).toEqual(upper)
    expect(interpolatePressureField({ lower, upper: missing, mix: 0 })).toEqual(lower)
  })
})
