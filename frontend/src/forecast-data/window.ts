import type { ForecastTimeSliceSelection } from '../forecast-time'

export type LoadedInterpolationWindow<T> = ForecastTimeSliceSelection & {
  lower: T
  upper: T
}

export function normalizeHourToken(value: string): string {
  return value.trim().padStart(3, '0')
}

export function clampInterpolationMix(mix: number): number {
  if (!Number.isFinite(mix)) return 0
  return Math.max(0, Math.min(1, mix))
}

export async function loadInterpolationWindow<T>(args: {
  selection: ForecastTimeSliceSelection
  previousWindow?: LoadedInterpolationWindow<T> | null
  loadTimeSlice: (hourToken: string) => Promise<T>
}): Promise<LoadedInterpolationWindow<T>> {
  const { selection, previousWindow, loadTimeSlice } = args
  const lowerHourToken = normalizeHourToken(selection.lowerHourToken)
  const upperHourToken = normalizeHourToken(selection.upperHourToken)
  const mix = clampInterpolationMix(selection.mix)
  const reuseTimeSlice = (hourToken: string): T | null => {
    if (!previousWindow) return null
    if (previousWindow.lowerHourToken === hourToken) return previousWindow.lower
    if (previousWindow.upperHourToken === hourToken) return previousWindow.upper
    return null
  }

  if (lowerHourToken === upperHourToken || mix === 0) {
    const lower = reuseTimeSlice(lowerHourToken) ?? await loadTimeSlice(lowerHourToken)
    return {
      lower,
      upper: lower,
      selectedValidTimeMs: selection.selectedValidTimeMs,
      lowerHourToken,
      upperHourToken: lowerHourToken,
      mix: 0,
    }
  }

  const reusableLower = reuseTimeSlice(lowerHourToken)
  const reusableUpper = reuseTimeSlice(upperHourToken)
  const [lower, upper] = await Promise.all([
    reusableLower ?? loadTimeSlice(lowerHourToken),
    reusableUpper ?? loadTimeSlice(upperHourToken),
  ])

  return {
    lower,
    upper,
    selectedValidTimeMs: selection.selectedValidTimeMs,
    lowerHourToken,
    upperHourToken,
    mix,
  }
}
