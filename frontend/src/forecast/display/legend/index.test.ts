import { describe, expect, it } from 'vitest'

import {
  getLegendTicks,
  toLegendContinuousGradient,
} from './index'
import type {
  GradientUnitOption,
} from '../units'

const CELSIUS_OPTION: GradientUnitOption = {
  id: 'celsius',
  label: 'C',
  valueFormat: 'whole',
  legendValueFormat: 'whole',
  legendLabels: [-30, -10, 0, 5, 30],
}

const CENTIMETERS_OPTION: GradientUnitOption = {
  id: 'centimeters',
  label: 'cm',
  scale: 100,
  legendLabels: [0, 50, { value: 100, label: '1m' }, { value: 300, label: '3m' }],
}

const stop = (value: number, color: [number, number, number] | [number, number, number, number]) => ({
  value,
  color,
})

describe('legend behavior', () => {
  it('evenly spaces configured labels regardless of numeric gaps', () => {
    const ticks = getLegendTicks(CELSIUS_OPTION)

    expect(ticks.map((tick) => tick.value)).toEqual([-30, -10, 0, 5, 30])
    expect(ticks.map((tick) => tick.positionPct)).toEqual([6, 28, 50, 72, 94])
    expect(ticks.map((tick) => tick.label)).toEqual(['-30', '-10', '0', '5', '30'])
  })

  it('builds the continuous gradient from every palette table stop', () => {
    const stops = [
      stop(-10, [0, 0, 0]),
      stop(-5, [20, 40, 60]),
      stop(0, [100, 110, 120, 128]),
      stop(10, [255, 255, 255]),
    ]

    const gradient = toLegendContinuousGradient(stops, 'to top')

    expect(gradient).toBe(
      'linear-gradient(to top, rgb(0 0 0) 0.0%, rgb(20 40 60) 25.0%, rgb(100 110 120 / 0.502) 50.0%, rgb(255 255 255) 100.0%)'
    )
  })

  it('keeps tick labels independent from palette stop positions', () => {
    const stops = [
      stop(0, [0, 0, 0]),
      stop(1.5, [128, 128, 128]),
      stop(3, [255, 255, 255]),
    ]

    expect(getLegendTicks(CENTIMETERS_OPTION).map((tick) => tick.label))
      .toEqual(['0', '50', '1m', '3m'])
    expect(toLegendContinuousGradient(stops, 'to top'))
      .toBe('linear-gradient(to top, rgb(0 0 0) 0.0%, rgb(128 128 128) 50.0%, rgb(255 255 255) 100.0%)')
  })

  it('throws when a unit option has no configured labels', () => {
    expect(() => getLegendTicks({
      ...CELSIUS_OPTION,
      legendLabels: [0],
    })).toThrow(/Missing legend labels/)
  })
})
