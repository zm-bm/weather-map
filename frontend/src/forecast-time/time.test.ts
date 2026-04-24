import { describe, expect, it } from 'vitest'

import {
  clampForecastValidTimeMs,
  hourOffsetMs,
  cycleMs,
  forecastTimeBounds,
  initialForecastValidTimeMs,
  minuteOffsetForValidTime,
  resolveForecastFrameWindow,
  stepForecastValidTimeMs,
  validTimeMs,
  validTimeMsForMinuteOffset,
} from './time'

describe('forecastTime helpers', () => {
  it('parses cycle to UTC epoch milliseconds', () => {
    expect(cycleMs('2026040900')).toBe(Date.UTC(2026, 3, 9, 0))
    expect(cycleMs('bad')).toBeNull()
  })

  it('converts forecast hour token to milliseconds', () => {
    expect(hourOffsetMs('003')).toBe(3 * 60 * 60 * 1000)
    expect(hourOffsetMs('-6')).toBe(0)
  })

  it('computes valid time from cycle and forecast hour', () => {
    expect(validTimeMs('2026040900', '006')).toBe(Date.UTC(2026, 3, 9, 6))
    expect(validTimeMs('oops', '006')).toBeNull()
  })

  it('clamps and snaps initial valid time into the available forecast window', () => {
    const forecastHours = ['000', '003', '006']

    expect(initialForecastValidTimeMs('2026040900', forecastHours, Date.UTC(2026, 3, 8, 23, 30)))
      .toBe(Date.UTC(2026, 3, 9, 0, 0))
    expect(initialForecastValidTimeMs('2026040900', forecastHours, Date.UTC(2026, 3, 9, 4, 14)))
      .toBe(Date.UTC(2026, 3, 9, 4, 10))
    expect(initialForecastValidTimeMs('2026040900', forecastHours, Date.UTC(2026, 3, 9, 9, 0)))
      .toBe(Date.UTC(2026, 3, 9, 6, 0))
  })

  it('maps minute offsets to valid times within the forecast window', () => {
    const forecastHours = ['000', '003', '006']
    const bounds = forecastTimeBounds('2026040900', forecastHours)

    expect(bounds).toEqual({
      startValidTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      endValidTimeMs: Date.UTC(2026, 3, 9, 6, 0),
      totalMinutes: 360,
    })
    expect(validTimeMsForMinuteOffset('2026040900', forecastHours, 30))
      .toBe(Date.UTC(2026, 3, 9, 0, 30))
    expect(minuteOffsetForValidTime('2026040900', forecastHours, Date.UTC(2026, 3, 9, 0, 30)))
      .toBe(30)
  })

  it('wraps timeline stepping across the forecast window on 10-minute boundaries', () => {
    const forecastHours = ['000', '003', '006']

    expect(stepForecastValidTimeMs(
      '2026040900',
      forecastHours,
      Date.UTC(2026, 3, 9, 6, 0),
      1
    )).toBe(Date.UTC(2026, 3, 9, 0, 0))
    expect(stepForecastValidTimeMs(
      '2026040900',
      forecastHours,
      Date.UTC(2026, 3, 9, 0, 0),
      -1
    )).toBe(Date.UTC(2026, 3, 9, 6, 0))
  })

  it('resolves exact and interpolated frame windows using actual valid times', () => {
    const forecastHours = ['000', '003', '006']

    expect(resolveForecastFrameWindow('2026040900', forecastHours, Date.UTC(2026, 3, 9, 3, 0))).toEqual({
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
      lowerHourToken: '003',
      upperHourToken: '003',
      lowerValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
      upperValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
      mix: 0,
    })

    const interpolated = resolveForecastFrameWindow(
      '2026040900',
      forecastHours,
      Date.UTC(2026, 3, 9, 4, 30)
    )
    expect(interpolated.lowerHourToken).toBe('003')
    expect(interpolated.upperHourToken).toBe('006')
    expect(interpolated.mix).toBeCloseTo(0.5)
  })

  it('clamps arbitrary times before resolving the frame window', () => {
    const forecastHours = ['000', '003', '006']

    expect(clampForecastValidTimeMs('2026040900', forecastHours, Date.UTC(2026, 3, 9, 8, 0)))
      .toBe(Date.UTC(2026, 3, 9, 6, 0))
    expect(clampForecastValidTimeMs('2026040900', forecastHours, Date.UTC(2026, 3, 9, 4, 19)))
      .toBe(Date.UTC(2026, 3, 9, 4, 10))
    expect(resolveForecastFrameWindow('2026040900', forecastHours, Date.UTC(2026, 3, 9, 8, 0)))
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
