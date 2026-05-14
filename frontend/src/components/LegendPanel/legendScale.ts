import type { LayerMeta } from '../../forecast-catalog'
import type { UnitOption } from '../../units'

export type LegendTick = {
  value: number
  positionPct: number
  label: string | null
  variant: 'major' | 'minor'
}

const TEMP_C_MAJOR_TICKS = [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50]
const TEMP_F_MAJOR_TICKS = [-40, -20, 0, 20, 40, 60, 80, 100, 120]
const PERCENT_MAJOR_TICKS = [0, 20, 40, 60, 80, 100]
const PERCENT_MINOR_TICKS = [10, 30, 50, 70, 90]
const PRESSURE_MAJOR_TICKS = [980, 990, 1000, 1010, 1020, 1030]
const PRESSURE_MINOR_TICKS = [985, 995, 1005, 1015, 1025]
const MM_RATE_MAJOR_TICKS = [0, 1, 3, 7, 15, 30]
const MM_RATE_MINOR_TICKS = [0.3, 5, 10, 20]
const IN_RATE_MAJOR_TICKS = [0, 0.03, 0.1, 0.3, 0.7, 1]
const IN_RATE_MINOR_TICKS = [0.01, 0.05, 0.5]
const MM_TOTAL_PRECIP_MAJOR_TICKS = [0, 10, 25, 50, 100, 150, 250]
const MM_TOTAL_PRECIP_MINOR_TICKS = [5, 75, 125, 200]
const IN_TOTAL_PRECIP_MAJOR_TICKS = [0, 0.5, 1, 2, 4, 6, 10]
const IN_TOTAL_PRECIP_MINOR_TICKS = [0.25, 3, 8]

type LegendScaleKind = LayerMeta['legendScale']

type LegendTickSet = {
  major: number[]
  minor: number[]
}

function toLegendGradient(meta: LayerMeta): string {
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

function filterCandidatesInRange(values: number[], min: number, max: number): number[] {
  const epsilon = Math.max(Math.abs(min), Math.abs(max), 1) * 1e-6
  return values.filter((value) => value >= min - epsilon && value <= max + epsilon)
}

function areClose(a: number, b: number): boolean {
  const epsilon = Math.max(Math.abs(a), Math.abs(b), 1) * 1e-6
  return Math.abs(a - b) <= epsilon
}

function getLinearizedRateTickPosition(value: number, majorTicks: number[], minorTicks: number[]): number {
  const orderedMajors = uniqueSorted(majorTicks)
  if (orderedMajors.length <= 1) return 0

  const directMajorIndex = orderedMajors.findIndex((candidate) => areClose(candidate, value))
  if (directMajorIndex >= 0) {
    return (directMajorIndex / (orderedMajors.length - 1)) * 100
  }

  for (let majorIndex = 0; majorIndex < orderedMajors.length - 1; majorIndex += 1) {
    const lowerMajor = orderedMajors[majorIndex]!
    const upperMajor = orderedMajors[majorIndex + 1]!
    if (value <= lowerMajor || value >= upperMajor) continue

    const segmentTicks = uniqueSorted([
      lowerMajor,
      ...minorTicks.filter((minorTick) => minorTick > lowerMajor && minorTick < upperMajor),
      upperMajor,
    ])
    const segmentIndex = segmentTicks.findIndex((candidate) => areClose(candidate, value))
    if (segmentIndex < 0) break

    const segmentStartPct = (majorIndex / (orderedMajors.length - 1)) * 100
    const segmentEndPct = ((majorIndex + 1) / (orderedMajors.length - 1)) * 100
    const intervalCount = segmentTicks.length - 1
    if (intervalCount <= 0) return segmentStartPct

    return segmentStartPct + ((segmentEndPct - segmentStartPct) * segmentIndex) / intervalCount
  }

  if (value < orderedMajors[0]!) return 0
  return 100
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

function buildStopBasedTicks(meta: LayerMeta, option: UnitOption, maxCount: number): number[] {
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

function getHardCodedTicks(kind: LegendScaleKind, units: string, min: number, max: number): LegendTickSet | null {
  switch (kind) {
    case 'percent':
      return {
        major: filterCandidatesInRange(PERCENT_MAJOR_TICKS, min, max),
        minor: filterCandidatesInRange(PERCENT_MINOR_TICKS, min, max),
      }
    case 'pressure':
      return {
        major: filterCandidatesInRange(PRESSURE_MAJOR_TICKS, min, max),
        minor: filterCandidatesInRange(PRESSURE_MINOR_TICKS, min, max),
      }
    case 'temperature':
      return {
        major: filterCandidatesInRange(units === 'F' ? TEMP_F_MAJOR_TICKS : TEMP_C_MAJOR_TICKS, min, max),
        minor: [],
      }
    case 'precip-rate':
      return {
        major: filterCandidatesInRange(units === 'in/hr' ? IN_RATE_MAJOR_TICKS : MM_RATE_MAJOR_TICKS, min, max),
        minor: filterCandidatesInRange(units === 'in/hr' ? IN_RATE_MINOR_TICKS : MM_RATE_MINOR_TICKS, min, max),
      }
    case 'precip-total':
      return {
        major: filterCandidatesInRange(units === 'in' ? IN_TOTAL_PRECIP_MAJOR_TICKS : MM_TOTAL_PRECIP_MAJOR_TICKS, min, max),
        minor: filterCandidatesInRange(units === 'in' ? IN_TOTAL_PRECIP_MINOR_TICKS : MM_TOTAL_PRECIP_MINOR_TICKS, min, max),
      }
    default:
      return null
  }
}

function getLegendTickValues(meta: LayerMeta, option: UnitOption): LegendTickSet {
  const min = option.convert(meta.min)
  const max = option.convert(meta.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return {
      major: [min],
      minor: [],
    }
  }

  const normalizedUnits = option.units.trim()
  const scaleKind = meta.legendScale
  const hardCodedTicks = getHardCodedTicks(scaleKind, normalizedUnits, min, max)
  if (hardCodedTicks && hardCodedTicks.major.length > 0) return hardCodedTicks

  const stopBased = buildStopBasedTicks(meta, option, 6)
  return {
    major: pruneTicksByDistance(stopBased, min, max),
    minor: [],
  }
}

export function getLegendTicks(meta: LayerMeta, option: UnitOption): LegendTick[] {
  const min = option.convert(meta.min)
  const max = option.convert(meta.max)
  const range = max - min || 1
  const ticks = getLegendTickValues(meta, option)
  const scaleKind = meta.legendScale
  const toLegendPosition = (value: number) => {
    if (scaleKind === 'precip-rate') {
      return getLinearizedRateTickPosition(value, ticks.major, ticks.minor)
    }
    return clamp(((value - min) / range) * 100, 0, 100)
  }
  const majorTicks = ticks.major.map((value) => ({
    value,
    positionPct: toLegendPosition(value),
    label: formatLegendValue(value, option.units),
    variant: 'major' as const,
  }))
  const minorTicks = ticks.minor.map((value) => ({
    value,
    positionPct: toLegendPosition(value),
    label: null,
    variant: 'minor' as const,
  }))

  return [...minorTicks, ...majorTicks].sort((a, b) => a.value - b.value)
}

export function toLegendSteppedGradient(meta: LayerMeta, direction = 'to top'): string {
  const range = meta.max - meta.min || 1
  const orderedStops = [...meta.colortable].sort((a, b) => a[0] - b[0])
  if (orderedStops.length < 2) return toLegendGradient(meta)
  const useEvenBandSpacing = meta.legendScale === 'precip-rate'

  const gradientStops: string[] = []
  const firstColor = orderedStops[0]
  gradientStops.push(`rgb(${firstColor[1]} ${firstColor[2]} ${firstColor[3]}) 0%`)

  for (let index = 0; index < orderedStops.length - 1; index += 1) {
    const current = orderedStops[index]
    const next = orderedStops[index + 1]
    const startPct = useEvenBandSpacing
      ? (index / (orderedStops.length - 1)) * 100
      : ((current[0] - meta.min) / range) * 100
    const endPct = useEvenBandSpacing
      ? ((index + 1) / (orderedStops.length - 1)) * 100
      : ((next[0] - meta.min) / range) * 100

    const clampedStart = clamp(startPct, 0, 100)
    const clampedEnd = clamp(endPct, 0, 100)
    const color = `rgb(${current[1]} ${current[2]} ${current[3]})`
    gradientStops.push(`${color} ${clampedStart.toFixed(2)}%`)
    gradientStops.push(`${color} ${clampedEnd.toFixed(2)}%`)
  }

  const last = orderedStops[orderedStops.length - 1]
  gradientStops.push(`rgb(${last[1]} ${last[2]} ${last[3]}) 100%`)

  return `linear-gradient(${direction}, ${gradientStops.join(', ')})`
}

function formatLegendValue(value: number, units: string): string {
  if (units === '%' || units === 'C' || units === 'F' || units === 'hPa') {
    return `${Math.round(value)}`
  }
  if (units === 'mm/hr' || units === 'in/hr') {
    if (Math.abs(value) >= 10) return `${Math.round(value)}`
    if (Math.abs(value) >= 1) return `${Number(value.toFixed(1)).toString()}`
    if (value === 0) return '0'
    return `${Number(value.toFixed(2)).toString()}`
  }
  if (Math.abs(value) >= 10) return `${Math.round(value)}`
  if (Number.isInteger(value)) return `${value}`
  return `${Number(value.toFixed(1)).toString()}`
}
