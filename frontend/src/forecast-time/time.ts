export const MINUTE_MS = 60 * 1000
export const FORECAST_TIME_STEP_MINUTES = 10
export const FORECAST_TIME_STEP_MS = FORECAST_TIME_STEP_MINUTES * MINUTE_MS
const HOUR_MS = 60 * MINUTE_MS

export type ForecastFrameSelection = {
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
}

export type ForecastFrameWindow = ForecastFrameSelection & {
  lowerValidTimeMs: number
  upperValidTimeMs: number
}

export function cycleMs(cycle: string | null | undefined): number | null {
  if (!cycle || !/^\d{10}$/.test(cycle)) return null

  const year = Number.parseInt(cycle.slice(0, 4), 10)
  const month = Number.parseInt(cycle.slice(4, 6), 10) - 1
  const day = Number.parseInt(cycle.slice(6, 8), 10)
  const hour = Number.parseInt(cycle.slice(8, 10), 10)

  return Date.UTC(year, month, day, hour)
}

export function hourOffsetMs(forecastHour: string): number {
  const hours = Number.parseInt(forecastHour, 10)
  if (!Number.isFinite(hours)) return 0
  return Math.max(0, hours) * HOUR_MS
}

export function validTimeMs(
  cycle: string | null | undefined,
  forecastHour: string
): number | null {
  const cycleEpochMs = cycleMs(cycle)
  if (cycleEpochMs == null) return null
  return cycleEpochMs + hourOffsetMs(forecastHour)
}

export function forecastValidTimeMsList(
  cycle: string | null | undefined,
  forecastHours: string[]
): number[] {
  return forecastHours.map((forecastHour) => validTimeMs(cycle, forecastHour) ?? 0)
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
  cycle: string | null | undefined,
  forecastHours: string[]
): { startValidTimeMs: number; endValidTimeMs: number; totalMinutes: number } | null {
  if (forecastHours.length === 0) return null
  const validTimes = forecastValidTimeMsList(cycle, forecastHours)
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
  cycle: string | null | undefined,
  forecastHours: string[],
  value: number
): number {
  const bounds = forecastTimeBounds(cycle, forecastHours)
  if (!bounds) return 0

  const normalized = normalizeMinuteMs(value)
  if (normalized <= bounds.startValidTimeMs) return bounds.startValidTimeMs
  if (normalized >= bounds.endValidTimeMs) return bounds.endValidTimeMs
  return normalized
}

export function initialForecastValidTimeMs(
  cycle: string | null | undefined,
  forecastHours: string[],
  nowMs = Date.now()
): number {
  return clampForecastValidTimeMs(cycle, forecastHours, nowMs)
}

export function minuteOffsetForValidTime(
  cycle: string | null | undefined,
  forecastHours: string[],
  validTimeMsValue: number
): number {
  const bounds = forecastTimeBounds(cycle, forecastHours)
  if (!bounds) return 0
  const clampedValidTimeMs = clampForecastValidTimeMs(cycle, forecastHours, validTimeMsValue)
  return normalizeMinuteOffset(
    Math.round((clampedValidTimeMs - bounds.startValidTimeMs) / MINUTE_MS),
    bounds.totalMinutes
  )
}

export function validTimeMsForMinuteOffset(
  cycle: string | null | undefined,
  forecastHours: string[],
  minuteOffset: number
): number {
  const bounds = forecastTimeBounds(cycle, forecastHours)
  if (!bounds) return 0

  const normalizedMinutes = normalizeMinuteOffset(minuteOffset, bounds.totalMinutes)
  return bounds.startValidTimeMs + (normalizedMinutes * MINUTE_MS)
}

export function stepForecastValidTimeMs(
  cycle: string | null | undefined,
  forecastHours: string[],
  currentValidTimeMs: number,
  stepCount: number
): number {
  const bounds = forecastTimeBounds(cycle, forecastHours)
  if (!bounds) return 0

  const steps = Math.floor(bounds.totalMinutes / FORECAST_TIME_STEP_MINUTES) + 1
  if (steps <= 1) return bounds.startValidTimeMs

  const currentOffset = minuteOffsetForValidTime(cycle, forecastHours, currentValidTimeMs)
  const currentStep = Math.floor(currentOffset / FORECAST_TIME_STEP_MINUTES)
  const nextStep = ((currentStep + normalizeStepCount(stepCount)) % steps + steps) % steps
  return bounds.startValidTimeMs + (nextStep * FORECAST_TIME_STEP_MS)
}

export function frameWindowMinuteOffset(
  frameWindow: Pick<ForecastFrameWindow, 'selectedValidTimeMs' | 'lowerValidTimeMs'>
): number {
  return Math.max(
    0,
    Math.round((frameWindow.selectedValidTimeMs - frameWindow.lowerValidTimeMs) / MINUTE_MS)
  )
}

export function resolveForecastFrameWindow(
  cycle: string | null | undefined,
  forecastHours: string[],
  selectedValidTimeMs: number
): ForecastFrameWindow {
  const clampedValidTimeMs = clampForecastValidTimeMs(cycle, forecastHours, selectedValidTimeMs)
  if (forecastHours.length === 0) {
    return {
      selectedValidTimeMs: clampedValidTimeMs,
      lowerHourToken: '000',
      upperHourToken: '000',
      lowerValidTimeMs: clampedValidTimeMs,
      upperValidTimeMs: clampedValidTimeMs,
      mix: 0,
    }
  }

  const validTimes = forecastValidTimeMsList(cycle, forecastHours)
  const firstValidTimeMs = validTimes[0] ?? clampedValidTimeMs
  const lastValidTimeMs = validTimes[validTimes.length - 1] ?? clampedValidTimeMs

  if (clampedValidTimeMs <= firstValidTimeMs) {
    const hourToken = forecastHours[0] ?? '000'
    return {
      selectedValidTimeMs: firstValidTimeMs,
      lowerHourToken: hourToken,
      upperHourToken: hourToken,
      lowerValidTimeMs: firstValidTimeMs,
      upperValidTimeMs: firstValidTimeMs,
      mix: 0,
    }
  }

  for (let idx = 0; idx < forecastHours.length - 1; idx += 1) {
    const lowerValidTimeMs = validTimes[idx] ?? clampedValidTimeMs
    const upperValidTimeMs = validTimes[idx + 1] ?? lowerValidTimeMs
    const lowerHourToken = forecastHours[idx] ?? '000'
    const upperHourToken = forecastHours[idx + 1] ?? lowerHourToken

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

  const lastHourToken = forecastHours[forecastHours.length - 1] ?? '000'
  return {
    selectedValidTimeMs: lastValidTimeMs,
    lowerHourToken: lastHourToken,
    upperHourToken: lastHourToken,
    lowerValidTimeMs: lastValidTimeMs,
    upperValidTimeMs: lastValidTimeMs,
    mix: 0,
  }
}
