import type {
  ForecastDataKind,
  ForecastDataTimeSlices,
  LoadedInterpolationWindow,
} from '../forecast-data-loaders'
import type { ForecastDataWindows } from './types'

export function setForecastDataWindow<K extends ForecastDataKind>(
  windows: ForecastDataWindows,
  id: K,
  window: LoadedInterpolationWindow<ForecastDataTimeSlices[K]>
): void {
  const mutableWindows = windows as Record<
    ForecastDataKind,
    LoadedInterpolationWindow<ForecastDataTimeSlices[ForecastDataKind]>
  >
  mutableWindows[id] = window
}
