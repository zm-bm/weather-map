import { describe, expect, it } from 'vitest'

import {
  closestHourIndex,
  hourOffsetMs,
  validTimeMs,
  cycleMs,
} from './core'

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

  it('picks the closest available forecast hour index', () => {
    const forecastHours = ['000', '003', '006']
    const nowMs = Date.UTC(2026, 3, 9, 4, 10)

    expect(closestHourIndex('2026040900', forecastHours, nowMs)).toBe(1)
    expect(closestHourIndex('oops', forecastHours, nowMs)).toBe(0)
    expect(closestHourIndex('2026040900', [], nowMs)).toBe(0)
  })
})
