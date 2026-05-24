import type {
  ForecastDataKind,
  ForecastDataSliceMap,
} from './slices'
import type { LoadedInterpolationWindow } from './interpolationWindow'
import type { ForecastDataWindows } from './types'

export function setForecastDataWindow<K extends ForecastDataKind>(
  windows: ForecastDataWindows,
  id: K,
  window: LoadedInterpolationWindow<ForecastDataSliceMap[K]>
): void {
  const mutableWindows = windows as Record<
    ForecastDataKind,
    LoadedInterpolationWindow<ForecastDataSliceMap[ForecastDataKind]>
  >
  mutableWindows[id] = window
}
