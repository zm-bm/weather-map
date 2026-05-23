import type { ForecastTimeSliceSelection } from '../forecast-time'
import { normalizeForecastHourToken } from '../forecast-manifest'
import type { LoadedInterpolationWindow } from '../forecast-data-loaders'
export type { LoadedInterpolationWindow } from '../forecast-data-loaders'

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
  const lowerHourToken = normalizeForecastHourToken(selection.lowerHourToken)
  const upperHourToken = normalizeForecastHourToken(selection.upperHourToken)
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
