import type { ForecastFrameSelection } from '../forecast-time'

import { normalizeFrameHourToken } from './loader'

export type LoadedFrameWindow<T> = ForecastFrameSelection & {
  lower: T
  upper: T
}

export function clampInterpolationMix(mix: number): number {
  if (!Number.isFinite(mix)) return 0
  return Math.max(0, Math.min(1, mix))
}

export async function loadFrameWindow<T>(args: {
  selection: ForecastFrameSelection
  previousWindow?: LoadedFrameWindow<T> | null
  loadFrame: (hourToken: string) => Promise<T>
}): Promise<LoadedFrameWindow<T>> {
  const { selection, previousWindow, loadFrame } = args
  const lowerHourToken = normalizeFrameHourToken(selection.lowerHourToken)
  const upperHourToken = normalizeFrameHourToken(selection.upperHourToken)
  const mix = clampInterpolationMix(selection.mix)
  const reuseFrame = (hourToken: string): T | null => {
    if (!previousWindow) return null
    if (previousWindow.lowerHourToken === hourToken) return previousWindow.lower
    if (previousWindow.upperHourToken === hourToken) return previousWindow.upper
    return null
  }

  if (lowerHourToken === upperHourToken || mix === 0) {
    const lower = reuseFrame(lowerHourToken) ?? await loadFrame(lowerHourToken)
    return {
      lower,
      upper: lower,
      selectedValidTimeMs: selection.selectedValidTimeMs,
      lowerHourToken,
      upperHourToken: lowerHourToken,
      mix: 0,
    }
  }

  const reusableLower = reuseFrame(lowerHourToken)
  const reusableUpper = reuseFrame(upperHourToken)
  const [lower, upper] = await Promise.all([
    reusableLower ?? loadFrame(lowerHourToken),
    reusableUpper ?? loadFrame(upperHourToken),
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
