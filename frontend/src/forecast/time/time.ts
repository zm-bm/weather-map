export const MINUTE_MS = 60 * 1000
export const FORECAST_TIME_STEP_MINUTES = 1
export const FORECAST_TIME_STEP_MS = FORECAST_TIME_STEP_MINUTES * MINUTE_MS

export type ForecastTimelineTime = {
  id: string
  valid_at: string
}

export type ForecastTimeSliceSelection = {
  selectedValidTimeMs: number
  lowerFrameId: string
  upperFrameId: string
  mix: number
}

export type ForecastInterpolationWindow = ForecastTimeSliceSelection & {
  lowerValidTimeMs: number
  upperValidTimeMs: number
}

function forecastTimeMs(time: ForecastTimelineTime): number | null {
  const epochMs = Date.parse(time.valid_at)
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
      lowerFrameId: '000',
      upperFrameId: '000',
      lowerValidTimeMs: clampedValidTimeMs,
      upperValidTimeMs: clampedValidTimeMs,
      mix: 0,
    }
  }

  const validTimes = forecastValidTimeMsList(times)
  const firstValidTimeMs = validTimes[0] ?? clampedValidTimeMs
  const lastValidTimeMs = validTimes[validTimes.length - 1] ?? clampedValidTimeMs

  if (clampedValidTimeMs <= firstValidTimeMs) {
    const frameId = times[0]?.id ?? '000'
    return {
      selectedValidTimeMs: firstValidTimeMs,
      lowerFrameId: frameId,
      upperFrameId: frameId,
      lowerValidTimeMs: firstValidTimeMs,
      upperValidTimeMs: firstValidTimeMs,
      mix: 0,
    }
  }

  for (let idx = 0; idx < times.length - 1; idx += 1) {
    const lowerValidTimeMs = validTimes[idx] ?? clampedValidTimeMs
    const upperValidTimeMs = validTimes[idx + 1] ?? lowerValidTimeMs
    const lowerFrameId = times[idx]?.id ?? '000'
    const upperFrameId = times[idx + 1]?.id ?? lowerFrameId

    if (clampedValidTimeMs === lowerValidTimeMs) {
      return {
        selectedValidTimeMs: clampedValidTimeMs,
        lowerFrameId,
        upperFrameId: lowerFrameId,
        lowerValidTimeMs,
        upperValidTimeMs: lowerValidTimeMs,
        mix: 0,
      }
    }

    if (clampedValidTimeMs < upperValidTimeMs) {
      const spanMs = Math.max(MINUTE_MS, upperValidTimeMs - lowerValidTimeMs)
      return {
        selectedValidTimeMs: clampedValidTimeMs,
        lowerFrameId,
        upperFrameId,
        lowerValidTimeMs,
        upperValidTimeMs,
        mix: Math.min(1, Math.max(0, (clampedValidTimeMs - lowerValidTimeMs) / spanMs)),
      }
    }

    if (clampedValidTimeMs === upperValidTimeMs) {
      return {
        selectedValidTimeMs: clampedValidTimeMs,
        lowerFrameId: upperFrameId,
        upperFrameId,
        lowerValidTimeMs: upperValidTimeMs,
        upperValidTimeMs,
        mix: 0,
      }
    }
  }

  const lastFrameId = times[times.length - 1]?.id ?? '000'
  return {
    selectedValidTimeMs: lastValidTimeMs,
    lowerFrameId: lastFrameId,
    upperFrameId: lastFrameId,
    lowerValidTimeMs: lastValidTimeMs,
    upperValidTimeMs: lastValidTimeMs,
    mix: 0,
  }
}
