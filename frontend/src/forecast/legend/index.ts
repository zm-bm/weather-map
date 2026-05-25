import { clamp, roughlyEqual } from '@/core/math'
import {
  normalizePaletteColor,
  type PaletteColorStop,
} from '@/forecast/palette'

export type LegendUnitOption = {
  id: string
  convert: (value: number) => number
}

type LegendTickPlacement = 'linear' | 'linearized-profile'
type LegendSteppedBandSpacing = 'value' | 'even'

type LegendProfileTickSet = {
  major: readonly number[]
  minor?: readonly number[]
}

type LegendProfile = {
  tickPlacement: LegendTickPlacement
  steppedBandSpacing: LegendSteppedBandSpacing
  omitTransparentMinStopInSteppedGradient?: boolean
  ticksByOptionId?: Record<string, LegendProfileTickSet>
}

const INCHES_PER_METER = 39.37007874015748

const LEGEND_PROFILES = {
  temperature: {
    tickPlacement: 'linear',
    steppedBandSpacing: 'value',
    ticksByOptionId: {
      celsius: { major: [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50] },
      fahrenheit: { major: [-40, -20, 0, 20, 40, 60, 80, 100, 120] },
    },
  },
  percent: {
    tickPlacement: 'linear',
    steppedBandSpacing: 'value',
    ticksByOptionId: {
      percent: {
        major: [0, 20, 40, 60, 80, 100],
        minor: [10, 30, 50, 70, 90],
      },
    },
  },
  pressure: {
    tickPlacement: 'linear',
    steppedBandSpacing: 'value',
    ticksByOptionId: {
      hectopascal: {
        major: [980, 992, 1004, 1016, 1028, 1036],
        minor: [984, 988, 996, 1000, 1008, 1012, 1020, 1024, 1032],
      },
    },
  },
  'precip-rate': {
    tickPlacement: 'linearized-profile',
    steppedBandSpacing: 'even',
    ticksByOptionId: {
      mm_per_hour: {
        major: [0, 1, 3, 7, 15, 30],
        minor: [0.3, 5, 10, 20],
      },
      in_per_hour: {
        major: [0, 0.03, 0.1, 0.3, 0.7, 1],
        minor: [0.01, 0.05, 0.5],
      },
    },
  },
  'precip-total': {
    tickPlacement: 'linear',
    steppedBandSpacing: 'value',
    ticksByOptionId: {
      millimeters: {
        major: [0, 10, 25, 50, 100, 150, 250],
        minor: [5, 75, 125, 200],
      },
      inches: {
        major: [0, 0.5, 1, 2, 4, 6, 10],
        minor: [0.25, 3, 8],
      },
    },
  },
  'snow-depth': {
    tickPlacement: 'linearized-profile',
    steppedBandSpacing: 'even',
    omitTransparentMinStopInSteppedGradient: true,
    ticksByOptionId: {
      centimeters: {
        major: [0, 2, 5, 10, 50, 100, 300],
        minor: [20, 200],
      },
      inches: {
        major: [
          0,
          0.02 * INCHES_PER_METER,
          0.05 * INCHES_PER_METER,
          0.1 * INCHES_PER_METER,
          0.5 * INCHES_PER_METER,
          1 * INCHES_PER_METER,
          3 * INCHES_PER_METER,
        ],
        minor: [
          0.2 * INCHES_PER_METER,
          2 * INCHES_PER_METER,
        ],
      },
    },
  },
  'stop-based': {
    tickPlacement: 'linear',
    steppedBandSpacing: 'value',
  },
} as const satisfies Record<string, LegendProfile>

export type LegendScale = keyof typeof LEGEND_PROFILES

export const LEGEND_SCALES = Object.keys(LEGEND_PROFILES) as LegendScale[]

const LEGEND_SCALE_SET = new Set<string>(LEGEND_SCALES)

export function isLegendScale(value: unknown): value is LegendScale {
  return typeof value === 'string' && LEGEND_SCALE_SET.has(value)
}

export function assertLegendScale(value: unknown): LegendScale {
  if (isLegendScale(value)) return value
  throw new Error(`Unknown legend scale: ${String(value)}`)
}

export function getLegendProfile(scale: LegendScale): LegendProfile {
  return LEGEND_PROFILES[scale]
}

export type LegendSpec = {
  min: number
  max: number
  legendScale: LegendScale
  stops: readonly PaletteColorStop[]
}

export type LegendTick = {
  value: number
  positionPct: number
  label: string | null
  variant: 'major' | 'minor'
}

type LegendTickSet = {
  major: number[]
  minor: number[]
}

type NormalizedColorStop = readonly [number, number, number, number, number]

export function toLegendContinuousGradient(spec: LegendSpec, direction = 'to top'): string {
  const range = spec.max - spec.min || 1
  const orderedStops = normalizeColorStops(spec).sort((a, b) => a[0] - b[0])
  const stops = orderedStops
    .map(([value, r, g, b, a]) => {
      const pct = ((value - spec.min) / range) * 100
      return `${legendColor(r, g, b, a)} ${clamp(pct, 0, 100).toFixed(1)}%`
    })
    .join(', ')

  return `linear-gradient(${direction}, ${stops})`
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b)
}

function sampleEvenly(values: readonly number[], maxCount: number): number[] {
  if (values.length <= maxCount) return [...values]
  if (maxCount <= 2) return [values[0]!, values[values.length - 1]!]

  const sampled: number[] = [values[0]!]
  for (let i = 1; i < maxCount - 1; i += 1) {
    const index = Math.round((i / (maxCount - 1)) * (values.length - 1))
    sampled.push(values[index]!)
  }
  sampled.push(values[values.length - 1]!)
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

function filterCandidatesInRange(values: readonly number[], min: number, max: number): number[] {
  const epsilon = Math.max(Math.abs(min), Math.abs(max), 1) * 1e-6
  return values.filter((value) => value >= min - epsilon && value <= max + epsilon)
}

function areClose(a: number, b: number): boolean {
  const epsilon = Math.max(Math.abs(a), Math.abs(b), 1) * 1e-6
  return roughlyEqual(a, b, epsilon)
}

function getLinearizedTickPosition(value: number, majorTicks: readonly number[], minorTicks: readonly number[]): number {
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

function buildStopBasedTicks(spec: LegendSpec, option: LegendUnitOption, maxCount: number): number[] {
  const min = option.convert(spec.min)
  const max = option.convert(spec.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]

  const convertedStops = uniqueSorted(
    spec.stops
      .map((stop) => option.convert(stop.value))
      .filter((value) => Number.isFinite(value) && value >= min && value <= max)
  )

  if (convertedStops.length < 3) return buildEvenTicks(min, max, maxCount)

  const ticks = uniqueSorted([min, ...sampleEvenly(convertedStops, maxCount), max])
  return sampleEvenly(ticks, maxCount)
}

function pruneTicksByDistance(ticks: readonly number[], min: number, max: number, minGapPct = 11): number[] {
  if (ticks.length <= 2) return [...ticks]
  const range = max - min || 1

  const sortedTicks = uniqueSorted(ticks)
  const result: number[] = [sortedTicks[0]!]
  let lastPct = ((sortedTicks[0]! - min) / range) * 100

  for (let i = 1; i < sortedTicks.length - 1; i += 1) {
    const pct = ((sortedTicks[i]! - min) / range) * 100
    if (pct - lastPct >= minGapPct) {
      result.push(sortedTicks[i]!)
      lastPct = pct
    }
  }

  const finalTick = sortedTicks[sortedTicks.length - 1]!
  const finalPct = ((finalTick - min) / range) * 100
  if (finalPct - lastPct < minGapPct * 0.65 && result.length > 1) {
    result.pop()
  }
  result.push(finalTick)
  return uniqueSorted(result)
}

function getProfileTicks(scale: LegendScale, optionId: string, min: number, max: number): LegendTickSet | null {
  const profile = getLegendProfile(scale)
  const ticks = profile.ticksByOptionId?.[optionId]
  if (!ticks) return null

  return {
    major: filterCandidatesInRange(ticks.major, min, max),
    minor: filterCandidatesInRange(ticks.minor ?? [], min, max),
  }
}

function getLegendTickValues(spec: LegendSpec, option: LegendUnitOption): LegendTickSet {
  const min = option.convert(spec.min)
  const max = option.convert(spec.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return {
      major: [min],
      minor: [],
    }
  }

  const profileTicks = getProfileTicks(spec.legendScale, option.id, min, max)
  if (profileTicks && profileTicks.major.length > 0) return profileTicks

  const stopBased = buildStopBasedTicks(spec, option, 6)
  return {
    major: pruneTicksByDistance(stopBased, min, max),
    minor: [],
  }
}

export function getLegendTicks(spec: LegendSpec, option: LegendUnitOption): LegendTick[] {
  const min = option.convert(spec.min)
  const max = option.convert(spec.max)
  const range = max - min || 1
  const ticks = getLegendTickValues(spec, option)
  const profile = getLegendProfile(spec.legendScale)
  const toLegendPosition = (value: number) => {
    if (profile.tickPlacement === 'linearized-profile') {
      return getLinearizedTickPosition(value, ticks.major, ticks.minor)
    }
    return clamp(((value - min) / range) * 100, 0, 100)
  }
  const majorTicks = ticks.major.map((value) => ({
    value,
    positionPct: toLegendPosition(value),
    label: formatLegendValue(value, option.id, spec.legendScale),
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

export function toLegendSteppedGradient(spec: LegendSpec, direction = 'to top'): string {
  const range = spec.max - spec.min || 1
  const orderedStops = steppedGradientColorStops(spec)
  if (orderedStops.length < 2) return toLegendContinuousGradient(spec, direction)
  const profile = getLegendProfile(spec.legendScale)
  const useEvenBandSpacing = profile.steppedBandSpacing === 'even'

  const gradientStops: string[] = []
  const firstColor = orderedStops[0]!
  gradientStops.push(`${legendColor(firstColor[1], firstColor[2], firstColor[3], firstColor[4])} 0%`)

  for (let index = 0; index < orderedStops.length - 1; index += 1) {
    const current = orderedStops[index]!
    const next = orderedStops[index + 1]!
    const startPct = useEvenBandSpacing
      ? (index / (orderedStops.length - 1)) * 100
      : ((current[0] - spec.min) / range) * 100
    const endPct = useEvenBandSpacing
      ? ((index + 1) / (orderedStops.length - 1)) * 100
      : ((next[0] - spec.min) / range) * 100

    const clampedStart = clamp(startPct, 0, 100)
    const clampedEnd = clamp(endPct, 0, 100)
    const color = legendColor(current[1], current[2], current[3], current[4])
    gradientStops.push(`${color} ${clampedStart.toFixed(2)}%`)
    gradientStops.push(`${color} ${clampedEnd.toFixed(2)}%`)
  }

  const last = orderedStops[orderedStops.length - 1]!
  gradientStops.push(`${legendColor(last[1], last[2], last[3], last[4])} 100%`)

  return `linear-gradient(${direction}, ${gradientStops.join(', ')})`
}

function steppedGradientColorStops(spec: LegendSpec): NormalizedColorStop[] {
  const orderedStops = normalizeColorStops(spec).sort((a, b) => a[0] - b[0])
  const profile = getLegendProfile(spec.legendScale)
  if (
    profile.omitTransparentMinStopInSteppedGradient
    && orderedStops.length > 1
    && roughlyEqual(orderedStops[0]?.[0] ?? Number.NaN, spec.min)
    && orderedStops[0]?.[4] === 0
  ) {
    return orderedStops.slice(1)
  }
  return orderedStops
}

function normalizeColorStops(spec: LegendSpec): NormalizedColorStop[] {
  return spec.stops.map((stop) => {
    const [r, g, b, a] = normalizePaletteColor(stop.color)
    return [stop.value, r, g, b, a]
  })
}

function legendColor(r: number, g: number, b: number, a: number): string {
  if (a >= 255) return `rgb(${r} ${g} ${b})`
  return `rgb(${r} ${g} ${b} / ${Number((a / 255).toFixed(3))})`
}

function formatLegendValue(value: number, optionId: string, legendScale: LegendScale): string {
  if (legendScale === 'snow-depth') return formatSnowDepthLegendValue(value, optionId)
  if (optionId === 'percent' || optionId === 'celsius' || optionId === 'fahrenheit' || optionId === 'hectopascal') {
    return `${Math.round(value)}`
  }
  if (optionId === 'mm_per_hour' || optionId === 'in_per_hour') {
    if (Math.abs(value) >= 10) return `${Math.round(value)}`
    if (Math.abs(value) >= 1) return `${Number(value.toFixed(1)).toString()}`
    if (value === 0) return '0'
    return `${Number(value.toFixed(2)).toString()}`
  }
  if (Math.abs(value) >= 10) return `${Math.round(value)}`
  if (Number.isInteger(value)) return `${value}`
  return `${Number(value.toFixed(1)).toString()}`
}

function formatSnowDepthLegendValue(value: number, optionId: string): string {
  if (value === 0) return '0'

  if (optionId === 'centimeters') {
    if (Math.abs(value) >= 100) return `${Math.round(value / 100)}m`
    if (Math.abs(value) >= 10) return `${Math.round(value)}`
    if (Number.isInteger(value)) return `${value}`
    return `${Number(value.toFixed(1)).toString()}`
  }

  if (optionId === 'inches') {
    if (Math.abs(value) >= 36) return `${Math.floor(value / 12)}ft`
    if (Math.abs(value) >= 1) return `${Math.round(value)}`
    return `${Number(value.toFixed(1)).toString()}`
  }

  return `${Number(value.toFixed(1)).toString()}`
}
