import { describe, expect, it } from 'vitest'

import {
  formatCycleRunTimeLabel,
  formatValidTimeScaleLabel,
  formatValidTimeTickLabel,
} from './format'

describe('forecast time format helpers', () => {
  it('formats compact UTC cycle run time labels', () => {
    expect(formatCycleRunTimeLabel('2026041118')).toBe('Apr 11, 18Z')
    expect(formatCycleRunTimeLabel('bad')).toBeNull()
  })

  it('formats scale tick labels with a date component', () => {
    const validTimeMs = Date.UTC(2026, 3, 11, 12, 0)

    expect(formatValidTimeScaleLabel(validTimeMs)).not.toBe(formatValidTimeTickLabel(validTimeMs))
    expect(formatValidTimeScaleLabel(null)).toBeNull()
  })

  it('formats midnight scale labels with weekday date context', () => {
    const localMidnightMs = new Date(2026, 3, 11, 0, 0, 0, 0).getTime()
    const label = formatValidTimeScaleLabel(localMidnightMs)
    const expected = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(localMidnightMs))

    expect(label).toBe(expected)
    expect(label).not.toMatch(/\b12\s?(AM|PM)\b|:/i)
  })
})
