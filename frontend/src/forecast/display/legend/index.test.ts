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

const FAHRENHEIT_OPTION: GradientUnitOption = {
  id: 'fahrenheit',
  label: 'F',
  scale: 9 / 5,
  offset: 32,
  valueFormat: 'whole',
  legendValueFormat: 'whole',
  legendLabels: [32, 41, 50],
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

  it('samples the continuous gradient from displayed-unit labels', () => {
    const stops = [
      stop(0, [0, 0, 0]),
      stop(10, [100, 100, 100]),
    ]

    const gradient = toLegendContinuousGradient(stops, FAHRENHEIT_OPTION, 'to top')

    expect(gradient).toBe(
      'linear-gradient(to top, rgb(0 0 0) 0.0%, rgb(0 0 0) 6.0%, rgb(50 50 50) 50.0%, rgb(100 100 100) 94.0%, rgb(100 100 100) 100.0%)'
    )
  })

  it('uses explicit label text while sampling colors from label values', () => {
    const stops = [
      stop(0, [0, 0, 0]),
      stop(3, [255, 255, 255]),
    ]

    expect(getLegendTicks(CENTIMETERS_OPTION).map((tick) => tick.label))
      .toEqual(['0', '50', '1m', '3m'])
    expect(toLegendContinuousGradient(stops, CENTIMETERS_OPTION, 'to top'))
      .toContain('rgb(85 85 85) 64.7%')
  })

  it('throws when a unit option has no configured labels', () => {
    expect(() => getLegendTicks({
      ...CELSIUS_OPTION,
      legendLabels: [0],
    })).toThrow(/Missing legend labels/)
  })
})
