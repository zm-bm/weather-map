import type { ActiveForecastRun, ForecastTimeSpec } from '../forecast-manifest'

export const MINUTE_MS = 60 * 1000
export const FORECAST_TIME_STEP_MINUTES = 10
export const FORECAST_TIME_STEP_MS = FORECAST_TIME_STEP_MINUTES * MINUTE_MS

export type ForecastTimelineTime = Pick<ForecastTimeSpec, 'id' | 'validAt'>

export type ForecastTimeSliceSelection = {
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
}

export type ForecastInterpolationWindow = ForecastTimeSliceSelection & {
  lowerValidTimeMs: number
  upperValidTimeMs: number
}

export function forecastTimeProviderKey(activeRun: ActiveForecastRun | null): string {
  if (activeRun == null) return 'forecast-time:none'
  const timelineKey = activeRun.latest.times.map((time) => `${time.id}:${time.validAt}`).join(',')
  return `forecast-time:${activeRun.modelId}:${activeRun.latest.run.cycle}:${timelineKey}`
}

function forecastTimeMs(time: ForecastTimelineTime): number | null {
  const epochMs = Date.parse(time.validAt)
  return Number.isFinite(epochMs) ? epochMs : null
}

export function forecastValidTimeMsList(times: ForecastTimelineTime[]): number[] {
  return times.map((time) => forecastTimeMs(time) ?? 0)
}

export function normalizeMinuteMs(validTimeMsValue: number): number {
  if (!Number.isFinite(validTimeMsValue)) return 0
  return Math.floor(validTimeMsValue / FORECAST_TIME_STEP_MS) * FORECAST_TIME_STEP_MS
}

function normalizeMinuteOffset(
  minuteOffset: number,
  totalMinutes: number
): number {
  if (!Number.isFinite(minuteOffset)) return 0

  const clampedMinutes = Math.max(0, Math.min(totalMinutes, Math.trunc(minuteOffset)))
  if (clampedMinutes === totalMinutes) return totalMinutes
  return Math.floor(clampedMinutes / FORECAST_TIME_STEP_MINUTES) * FORECAST_TIME_STEP_MINUTES
}

function normalizeStepCount(stepCount: number): number {
  if (!Number.isFinite(stepCount)) return 0
  return Math.trunc(stepCount)
}

export function forecastTimeBounds(
  times: ForecastTimelineTime[]
): { startValidTimeMs: number; endValidTimeMs: number; totalMinutes: number } | null {
  if (times.length === 0) return null
  const validTimes = forecastValidTimeMsList(times)
  const startValidTimeMs = validTimes[0]
  const endValidTimeMs = validTimes[validTimes.length - 1]
  if (!Number.isFinite(startValidTimeMs) || !Number.isFinite(endValidTimeMs)) return null

  return {
    startValidTimeMs,
    endValidTimeMs,
    totalMinutes: Math.max(0, Math.round((endValidTimeMs - startValidTimeMs) / MINUTE_MS)),
  }
}

export function clampForecastValidTimeMs(
  times: ForecastTimelineTime[],
  value: number
): number {
  const bounds = forecastTimeBounds(times)
  if (!bounds) return 0

  const normalized = normalizeMinuteMs(value)
  if (normalized <= bounds.startValidTimeMs) return bounds.startValidTimeMs
  if (normalized >= bounds.endValidTimeMs) return bounds.endValidTimeMs
  return normalized
}

export function initialForecastValidTimeMs(
  times: ForecastTimelineTime[],
  nowMs = Date.now()
): number {
  return clampForecastValidTimeMs(times, nowMs)
}

export function minuteOffsetForValidTime(
  times: ForecastTimelineTime[],
  validTimeMsValue: number
): number {
  const bounds = forecastTimeBounds(times)
  if (!bounds) return 0
  const clampedValidTimeMs = clampForecastValidTimeMs(times, validTimeMsValue)
  return normalizeMinuteOffset(
    Math.round((clampedValidTimeMs - bounds.startValidTimeMs) / MINUTE_MS),
    bounds.totalMinutes
  )
}

export function validTimeMsForMinuteOffset(
  times: ForecastTimelineTime[],
  minuteOffset: number
): number {
  const bounds = forecastTimeBounds(times)
  if (!bounds) return 0

  const normalizedMinutes = normalizeMinuteOffset(minuteOffset, bounds.totalMinutes)
  return bounds.startValidTimeMs + (normalizedMinutes * MINUTE_MS)
}

export function stepForecastValidTimeMs(
  times: ForecastTimelineTime[],
  currentValidTimeMs: number,
  stepCount: number
): number {
  const bounds = forecastTimeBounds(times)
  if (!bounds) return 0

  const steps = Math.floor(bounds.totalMinutes / FORECAST_TIME_STEP_MINUTES) + 1
  if (steps <= 1) return bounds.startValidTimeMs

  const currentOffset = minuteOffsetForValidTime(times, currentValidTimeMs)
  const currentStep = Math.floor(currentOffset / FORECAST_TIME_STEP_MINUTES)
  const nextStep = ((currentStep + normalizeStepCount(stepCount)) % steps + steps) % steps
  return bounds.startValidTimeMs + (nextStep * FORECAST_TIME_STEP_MS)
}

export function interpolationWindowMinuteOffset(
  interpolationWindow: Pick<ForecastInterpolationWindow, 'selectedValidTimeMs' | 'lowerValidTimeMs'>
): number {
  return Math.max(
    0,
    Math.round((interpolationWindow.selectedValidTimeMs - interpolationWindow.lowerValidTimeMs) / MINUTE_MS)
  )
}

export function resolveForecastInterpolationWindow(
  times: ForecastTimelineTime[],
  selectedValidTimeMs: number
): ForecastInterpolationWindow {
  const clampedValidTimeMs = clampForecastValidTimeMs(times, selectedValidTimeMs)
  if (times.length === 0) {
    return {
      selectedValidTimeMs: clampedValidTimeMs,
      lowerHourToken: '000',
      upperHourToken: '000',
      lowerValidTimeMs: clampedValidTimeMs,
      upperValidTimeMs: clampedValidTimeMs,
      mix: 0,
    }
  }

  const validTimes = forecastValidTimeMsList(times)
  const firstValidTimeMs = validTimes[0] ?? clampedValidTimeMs
  const lastValidTimeMs = validTimes[validTimes.length - 1] ?? clampedValidTimeMs

  if (clampedValidTimeMs <= firstValidTimeMs) {
    const hourToken = times[0]?.id ?? '000'
    return {
      selectedValidTimeMs: firstValidTimeMs,
      lowerHourToken: hourToken,
      upperHourToken: hourToken,
      lowerValidTimeMs: firstValidTimeMs,
      upperValidTimeMs: firstValidTimeMs,
      mix: 0,
    }
  }

  for (let idx = 0; idx < times.length - 1; idx += 1) {
    const lowerValidTimeMs = validTimes[idx] ?? clampedValidTimeMs
    const upperValidTimeMs = validTimes[idx + 1] ?? lowerValidTimeMs
    const lowerHourToken = times[idx]?.id ?? '000'
    const upperHourToken = times[idx + 1]?.id ?? lowerHourToken

    if (clampedValidTimeMs === lowerValidTimeMs) {
      return {
        selectedValidTimeMs: clampedValidTimeMs,
        lowerHourToken,
        upperHourToken: lowerHourToken,
        lowerValidTimeMs,
        upperValidTimeMs: lowerValidTimeMs,
        mix: 0,
      }
    }

    if (clampedValidTimeMs < upperValidTimeMs) {
      const spanMs = Math.max(MINUTE_MS, upperValidTimeMs - lowerValidTimeMs)
      return {
        selectedValidTimeMs: clampedValidTimeMs,
        lowerHourToken,
        upperHourToken,
        lowerValidTimeMs,
        upperValidTimeMs,
        mix: Math.min(1, Math.max(0, (clampedValidTimeMs - lowerValidTimeMs) / spanMs)),
      }
    }

    if (clampedValidTimeMs === upperValidTimeMs) {
      return {
        selectedValidTimeMs: clampedValidTimeMs,
        lowerHourToken: upperHourToken,
        upperHourToken,
        lowerValidTimeMs: upperValidTimeMs,
        upperValidTimeMs,
        mix: 0,
      }
    }
  }

  const lastHourToken = times[times.length - 1]?.id ?? '000'
  return {
    selectedValidTimeMs: lastValidTimeMs,
    lowerHourToken: lastHourToken,
    upperHourToken: lastHourToken,
    lowerValidTimeMs: lastValidTimeMs,
    upperValidTimeMs: lastValidTimeMs,
    mix: 0,
  }
}
