import type { ScalarLayerMeta } from '../../map/scalar'

export type LegendUnitOption = {
  id: string
  buttonLabel: string
  units: string
  convert: (value: number) => number
}

export type LegendUnitDisplay = {
  defaultOptionId: string
  options: LegendUnitOption[]
}

export type LegendTick = {
  value: number
  positionPct: number
}

type LegendUnitRule = {
  units?: string[]
  labelIncludes?: string[]
  display: LegendUnitDisplay
}

export function toLegendGradient(meta: ScalarLayerMeta): string {
  const range = meta.max - meta.min || 1
  const orderedStops = [...meta.colortable].sort((a, b) => a[0] - b[0])
  const stops = orderedStops
    .map(([value, r, g, b]) => {
      const pct = ((value - meta.min) / range) * 100
      return `rgb(${r} ${g} ${b}) ${Math.max(0, Math.min(100, pct)).toFixed(1)}%`
    })
    .join(', ')

  return `linear-gradient(90deg, ${stops})`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b)
}

function sampleEvenly(values: number[], maxCount: number): number[] {
  if (values.length <= maxCount) return values
  if (maxCount <= 2) return [values[0], values[values.length - 1]]

  const sampled: number[] = [values[0]]
  for (let i = 1; i < maxCount - 1; i += 1) {
    const index = Math.round((i / (maxCount - 1)) * (values.length - 1))
    sampled.push(values[index])
  }
  sampled.push(values[values.length - 1])
  return uniqueSorted(sampled)
}

function niceStep(roughStep: number): number {
  if (!Number.isFinite(roughStep) || roughStep <= 0) return 1
  const power = Math.floor(Math.log10(roughStep))
  const normalized = roughStep / 10 ** power
  let niceNormalized = 1
  if (normalized > 1) niceNormalized = 2
  if (normalized > 2) niceNormalized = 2.5
  if (normalized > 2.5) niceNormalized = 5
  if (normalized > 5) niceNormalized = 10
  return niceNormalized * 10 ** power
}

function selectTickTarget(units: string, label: string): number {
  if (units === '%' || label.includes('humidity')) return 6
  if (units === 'hPa' || units === 'Pa' || label.includes('pressure')) return 7
  if (units === 'C' || units === 'F' || label.includes('temperature')) return 6
  return 6
}

function buildEvenTicks(min: number, max: number, targetCount: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]
  const span = max - min
  const step = niceStep(span / Math.max(targetCount - 1, 1))
  const start = Math.ceil(min / step) * step
  const ticks: number[] = [min]

  for (let value = start; value < max; value += step) {
    ticks.push(value)
  }
  ticks.push(max)

  const uniqueTicks = uniqueSorted(ticks)
  if (uniqueTicks.length <= targetCount + 1) return uniqueTicks
  return sampleEvenly(uniqueTicks, targetCount)
}

function buildStopBasedTicks(meta: ScalarLayerMeta, option: LegendUnitOption, maxCount: number): number[] {
  const min = option.convert(meta.min)
  const max = option.convert(meta.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]

  const convertedStops = uniqueSorted(
    meta.colortable
      .map(([value]) => option.convert(value))
      .filter((value) => Number.isFinite(value) && value >= min && value <= max)
  )

  if (convertedStops.length < 3) return buildEvenTicks(min, max, maxCount)

  const ticks = uniqueSorted([min, ...sampleEvenly(convertedStops, maxCount), max])
  return sampleEvenly(ticks, maxCount)
}

function pruneTicksByDistance(ticks: number[], min: number, max: number, minGapPct = 11): number[] {
  if (ticks.length <= 2) return ticks
  const range = max - min || 1

  const sortedTicks = uniqueSorted(ticks)
  const result: number[] = [sortedTicks[0]]
  let lastPct = ((sortedTicks[0] - min) / range) * 100

  for (let i = 1; i < sortedTicks.length - 1; i += 1) {
    const pct = ((sortedTicks[i] - min) / range) * 100
    if (pct - lastPct >= minGapPct) {
      result.push(sortedTicks[i])
      lastPct = pct
    }
  }

  const finalTick = sortedTicks[sortedTicks.length - 1]
  const finalPct = ((finalTick - min) / range) * 100
  if (finalPct - lastPct < minGapPct * 0.65 && result.length > 1) {
    result.pop()
  }
  result.push(finalTick)
  return uniqueSorted(result)
}

function getLegendTickValues(meta: ScalarLayerMeta, option: LegendUnitOption): number[] {
  const min = option.convert(meta.min)
  const max = option.convert(meta.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]

  const normalizedUnits = option.units.trim()
  const normalizedLabel = meta.label.trim().toLowerCase()
  const targetCount = selectTickTarget(normalizedUnits, normalizedLabel)

  if (normalizedUnits === '%' || normalizedLabel.includes('humidity')) {
    return [0, 20, 40, 60, 80, 100].filter((value) => value >= min && value <= max)
  }

  const stopBased = buildStopBasedTicks(meta, option, targetCount)
  return pruneTicksByDistance(stopBased, min, max)
}

export function getLegendTicks(meta: ScalarLayerMeta, option: LegendUnitOption): LegendTick[] {
  const min = option.convert(meta.min)
  const max = option.convert(meta.max)
  const range = max - min || 1
  const ticks = getLegendTickValues(meta, option)
  return ticks.map((value) => ({
    value,
    positionPct: clamp(((value - min) / range) * 100, 3, 97),
  }))
}

export function toLegendSteppedGradient(meta: ScalarLayerMeta, direction = 'to top'): string {
  const range = meta.max - meta.min || 1
  const orderedStops = [...meta.colortable].sort((a, b) => a[0] - b[0])
  if (orderedStops.length < 2) return toLegendGradient(meta)

  const gradientStops: string[] = []
  const firstColor = orderedStops[0]
  gradientStops.push(`rgb(${firstColor[1]} ${firstColor[2]} ${firstColor[3]}) 0%`)

  for (let index = 0; index < orderedStops.length - 1; index += 1) {
    const current = orderedStops[index]
    const next = orderedStops[index + 1]
    const currentPct = clamp(((current[0] - meta.min) / range) * 100, 0, 100)
    const nextPct = clamp(((next[0] - meta.min) / range) * 100, 0, 100)
    const currentColor = `rgb(${current[1]} ${current[2]} ${current[3]})`
    const nextColor = `rgb(${next[1]} ${next[2]} ${next[3]})`

    gradientStops.push(`${currentColor} ${currentPct.toFixed(2)}%`)
    gradientStops.push(`${currentColor} ${nextPct.toFixed(2)}%`)
    gradientStops.push(`${nextColor} ${nextPct.toFixed(2)}%`)
  }

  const lastColor = orderedStops[orderedStops.length - 1]
  gradientStops.push(`rgb(${lastColor[1]} ${lastColor[2]} ${lastColor[3]}) 100%`)

  return `linear-gradient(${direction}, ${gradientStops.join(', ')})`
}

export function formatLegendValue(value: number, units: string): string {
  if (units === '%') return `${Math.round(value)}%`
  if (units === 'Pa') return `${Math.round(value).toLocaleString()} ${units}`
  if (units === 'mm/hr' || units === 'in/hr') {
    if (Math.abs(value) >= 100) return `${Math.round(value)} ${units}`
    if (Math.abs(value) >= 10) return `${value.toFixed(1)} ${units}`
    if (Math.abs(value) >= 1) return `${value.toFixed(2)} ${units}`
    return `${value.toFixed(3)} ${units}`
  }
  if (units) return `${Math.round(value)} ${units}`
  return `${Math.round(value)}`
}

const LEGEND_UNIT_OVERRIDES: Record<string, LegendUnitRule> = {
  temperature_celsius: {
    units: ['c'],
    labelIncludes: ['temperature'],
    display: {
      defaultOptionId: 'c',
      options: [
        { id: 'c', buttonLabel: 'C', units: 'C', convert: (value) => value },
        { id: 'f', buttonLabel: 'F', units: 'F', convert: (value) => (value * 9) / 5 + 32 },
      ],
    },
  },
  pressure_pascal: {
    units: ['pa'],
    labelIncludes: ['pressure'],
    display: {
      defaultOptionId: 'hpa',
      options: [
        { id: 'hpa', buttonLabel: 'hPa', units: 'hPa', convert: (value) => value / 100 },
        { id: 'pa', buttonLabel: 'Pa', units: 'Pa', convert: (value) => value },
      ],
    },
  },
  precipitation_rate_kg_m2_s: {
    units: ['kg/m^2/s'],
    labelIncludes: ['precipitation rate'],
    display: {
      defaultOptionId: 'mmhr',
      options: [
        { id: 'mmhr', buttonLabel: 'mm/hr', units: 'mm/hr', convert: (value) => value * 3600 },
        { id: 'inhr', buttonLabel: 'in/hr', units: 'in/hr', convert: (value) => value * 141.73236 },
      ],
    },
  },
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

export function getLegendUnitDisplay(meta: ScalarLayerMeta): LegendUnitDisplay {
  const units = normalizeToken(meta.units)
  const label = normalizeToken(meta.label)

  const override = Object.values(LEGEND_UNIT_OVERRIDES).find((rule) => {
    const unitMatch = rule.units?.includes(units) ?? false
    const labelMatch = rule.labelIncludes?.some((token) => label.includes(token)) ?? false
    return unitMatch || labelMatch
  })

  if (override) return override.display

  return {
    defaultOptionId: 'native',
    options: [{ id: 'native', buttonLabel: meta.units || '-', units: meta.units, convert: (value) => value }],
  }
}
