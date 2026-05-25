import { describe, expect, it } from 'vitest'

import {
  assertLegendScale,
  getLegendTicks,
  isLegendScale,
  toLegendContinuousGradient,
  toLegendSteppedGradient,
  type LegendSpec,
  type LegendUnitOption,
} from './index'

const IDENTITY_OPTION: LegendUnitOption = {
  id: 'identity',
  convert: (value) => value,
}

const CELSIUS_OPTION: LegendUnitOption = {
  id: 'celsius',
  convert: (value) => value,
}

const HECTOPASCAL_OPTION: LegendUnitOption = {
  id: 'hectopascal',
  convert: (value) => value / 100,
}

const IN_PER_HOUR_OPTION: LegendUnitOption = {
  id: 'in_per_hour',
  convert: (value) => value / 25.4,
}

const CENTIMETERS_OPTION: LegendUnitOption = {
  id: 'centimeters',
  convert: (value) => value * 100,
}

const INCHES_OPTION: LegendUnitOption = {
  id: 'inches',
  convert: (value) => value * 39.37007874015748,
}

describe('legend scale behavior', () => {
  it('validates known legend scales', () => {
    expect(isLegendScale('temperature')).toBe(true)
    expect(isLegendScale('snow-depth')).toBe(true)
    expect(assertLegendScale('temperature')).toBe('temperature')
    expect(isLegendScale('bogus')).toBe(false)
    expect(() => assertLegendScale('bogus')).toThrow('Unknown legend scale: bogus')
  })

  it('uses hard-coded temperature ticks in selected units', () => {
    const spec: LegendSpec = {
      min: -35,
      max: 50,
      legendScale: 'temperature',
      colorStops: [
        [-35, 0, 0, 0],
        [50, 255, 255, 255],
      ],
    }
    const labels = getLegendTicks(spec, CELSIUS_OPTION)
      .filter((tick) => tick.variant === 'major')
      .map((tick) => tick.label)

    expect(labels).toContain('-30')
    expect(labels).toContain('0')
    expect(labels).toContain('50')
  })

  it('uses hard-coded pressure ticks after unit conversion', () => {
    const spec: LegendSpec = {
      min: 98_000,
      max: 103_600,
      legendScale: 'pressure',
      colorStops: [
        [98_000, 0, 0, 0],
        [103_600, 255, 255, 255],
      ],
    }
    const ticks = getLegendTicks(spec, HECTOPASCAL_OPTION)

    expect(ticks.find((tick) => tick.value === 980)?.label).toBe('980')
    expect(ticks.find((tick) => tick.value === 1036)?.label).toBe('1036')
  })

  it('uses linearized tick positions for precipitation rate bands', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 30,
      legendScale: 'precip-rate',
      colorStops: [
        [0, 0, 0, 0],
        [15, 128, 128, 128],
        [30, 255, 255, 255],
      ],
    }
    const ticks = getLegendTicks(spec, IN_PER_HOUR_OPTION)

    expect(ticks.find((tick) => tick.value === 0)?.positionPct).toBe(0)
    expect(ticks.find((tick) => tick.value === 0.7)?.positionPct).toBe(80)
    expect(ticks.find((tick) => tick.value === 1)?.positionPct).toBe(100)
  })

  it('uses Windy-style nonlinear metric snow depth ticks', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 3,
      legendScale: 'snow-depth',
      colorStops: [
        [0, 0, 0, 0],
        [3, 255, 255, 255],
      ],
    }

    const majorTicks = getLegendTicks(spec, CENTIMETERS_OPTION)
      .filter((tick) => tick.variant === 'major')

    expect(majorTicks.map((tick) => tick.label)).toEqual(['0', '2', '5', '10', '50', '1m', '3m'])
    expect(majorTicks.map((tick) => tick.positionPct)).toEqual([0, 16.666666666666664, 33.33333333333333, 50, 66.66666666666666, 83.33333333333334, 100])
  })

  it('uses Windy-style nonlinear imperial snow depth labels', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 3,
      legendScale: 'snow-depth',
      colorStops: [
        [0, 0, 0, 0],
        [3, 255, 255, 255],
      ],
    }

    const labels = getLegendTicks(spec, INCHES_OPTION)
      .filter((tick) => tick.variant === 'major')
      .map((tick) => tick.label)

    expect(labels).toEqual(['0', '0.8', '2', '4', '20', '3ft', '9ft'])
  })

  it('falls back to even stop-based ticks when there are too few color stops', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 8,
      legendScale: 'stop-based',
      colorStops: [
        [0, 0, 0, 0],
        [8, 255, 255, 255],
      ],
    }

    const ticks = getLegendTicks(spec, IDENTITY_OPTION)

    expect(ticks.map((tick) => tick.value)).toEqual([0, 2, 4, 6, 8])
  })

  it('builds stepped gradients and evenly spaces precipitation rate color bands', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 30,
      legendScale: 'precip-rate',
      colorStops: [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
      ],
    }

    const gradient = toLegendSteppedGradient(spec, 'to top')

    expect(gradient).toContain('linear-gradient(to top')
    expect(gradient).toContain('rgb(1 1 1) 0.00%')
    expect(gradient).toContain('rgb(1 1 1) 50.00%')
    expect(gradient).toContain('rgb(2 2 2) 50.00%')
    expect(gradient).toContain('rgb(2 2 2) 100.00%')
  })

  it('builds continuous gradients with value-positioned color stops', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 10,
      legendScale: 'stop-based',
      colorStops: [
        [0, 1, 1, 1],
        [5, 2, 2, 2],
        [10, 3, 3, 3],
      ],
    }

    const gradient = toLegendContinuousGradient(spec, 'to top')

    expect(gradient).toContain('linear-gradient(to top')
    expect(gradient).toContain('rgb(1 1 1) 0.0%')
    expect(gradient).toContain('rgb(2 2 2) 50.0%')
    expect(gradient).toContain('rgb(3 3 3) 100.0%')
  })

  it('builds stepped gradients and evenly spaces snow depth color bands', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 3,
      legendScale: 'snow-depth',
      colorStops: [
        [0, 1, 1, 1, 0],
        [0.02, 2, 2, 2],
        [3, 3, 3, 3],
      ],
    }

    const gradient = toLegendSteppedGradient(spec, 'to top')

    expect(gradient).not.toContain('rgb(1 1 1 / 0)')
    expect(gradient).toContain('rgb(2 2 2) 0.00%')
    expect(gradient).toContain('rgb(2 2 2) 100.00%')
  })

  it('includes explicit alpha in stepped gradients', () => {
    const spec: LegendSpec = {
      min: 0,
      max: 1,
      legendScale: 'stop-based',
      colorStops: [
        [0, 1, 2, 3, 0],
        [1, 4, 5, 6],
      ],
    }

    const gradient = toLegendSteppedGradient(spec, 'to top')

    expect(gradient).toContain('rgb(1 2 3 / 0) 0%')
    expect(gradient).toContain('rgb(1 2 3 / 0) 0.00%')
    expect(gradient).toContain('rgb(4 5 6) 100%')
  })
})
