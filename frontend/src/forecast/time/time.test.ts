import { describe, expect, it } from 'vitest'

import {
  clampForecastValidTimeMs,
  forecastTimeBounds,
  initialForecastValidTimeMs,
  minuteOffsetForValidTime,
  resolveForecastInterpolationWindow,
  stepForecastValidTimeMs,
  validTimeMsForMinuteOffset,
} from './time'

const TIMES = [
  { id: '000', validAt: '2026-04-09T00:00:00.000Z' },
  { id: '003', validAt: '2026-04-09T03:00:00.000Z' },
  { id: '006', validAt: '2026-04-09T06:00:00.000Z' },
]

describe('forecastTime helpers', () => {
  it('clamps and snaps initial valid time into the available forecast window', () => {
    expect(initialForecastValidTimeMs(TIMES, Date.UTC(2026, 3, 8, 23, 30)))
      .toBe(Date.UTC(2026, 3, 9, 0, 0))
    expect(initialForecastValidTimeMs(TIMES, Date.UTC(2026, 3, 9, 4, 14)))
      .toBe(Date.UTC(2026, 3, 9, 4, 14))
    expect(initialForecastValidTimeMs(TIMES, Date.UTC(2026, 3, 9, 9, 0)))
      .toBe(Date.UTC(2026, 3, 9, 6, 0))
  })

  it('maps minute offsets to valid times within the forecast window', () => {
    const bounds = forecastTimeBounds(TIMES)

    expect(bounds).toEqual({
      startValidTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      endValidTimeMs: Date.UTC(2026, 3, 9, 6, 0),
      totalMinutes: 360,
    })
    expect(validTimeMsForMinuteOffset(TIMES, 30))
      .toBe(Date.UTC(2026, 3, 9, 0, 30))
    expect(minuteOffsetForValidTime(TIMES, Date.UTC(2026, 3, 9, 0, 30)))
      .toBe(30)
  })

  it('wraps timeline stepping across the forecast window on minute boundaries', () => {
    expect(stepForecastValidTimeMs(
      TIMES,
      Date.UTC(2026, 3, 9, 0, 0),
      1
    )).toBe(Date.UTC(2026, 3, 9, 0, 1))
    expect(stepForecastValidTimeMs(
      TIMES,
      Date.UTC(2026, 3, 9, 6, 0),
      1
    )).toBe(Date.UTC(2026, 3, 9, 0, 0))
    expect(stepForecastValidTimeMs(
      TIMES,
      Date.UTC(2026, 3, 9, 0, 0),
      -1
    )).toBe(Date.UTC(2026, 3, 9, 6, 0))
  })

  it('resolves exact and interpolated valid times into interpolation windows', () => {
    expect(resolveForecastInterpolationWindow(TIMES, Date.UTC(2026, 3, 9, 3, 0))).toEqual({
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
      lowerHourToken: '003',
      upperHourToken: '003',
      lowerValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
      upperValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
      mix: 0,
    })

    const interpolated = resolveForecastInterpolationWindow(
      TIMES,
      Date.UTC(2026, 3, 9, 4, 30)
    )
    expect(interpolated.lowerHourToken).toBe('003')
    expect(interpolated.upperHourToken).toBe('006')
    expect(interpolated.mix).toBeCloseTo(0.5)
  })

  it('clamps arbitrary times before resolving the interpolation window', () => {
    expect(clampForecastValidTimeMs(TIMES, Date.UTC(2026, 3, 9, 8, 0)))
      .toBe(Date.UTC(2026, 3, 9, 6, 0))
    expect(clampForecastValidTimeMs(TIMES, Date.UTC(2026, 3, 9, 4, 19)))
      .toBe(Date.UTC(2026, 3, 9, 4, 19))
    expect(resolveForecastInterpolationWindow(TIMES, Date.UTC(2026, 3, 9, 8, 0)))
      .toEqual({
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 6, 0),
        lowerHourToken: '006',
        upperHourToken: '006',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 6, 0),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 6, 0),
        mix: 0,
      })
  })
})
