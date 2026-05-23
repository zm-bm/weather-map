import type {
  ForecastProductId,
  ForecastProductTimeSlices,
  ForecastProductWindows,
} from './types'
import type { LoadedInterpolationWindow } from './window'

export function setForecastProductWindow<K extends ForecastProductId>(
  products: ForecastProductWindows,
  id: K,
  window: LoadedInterpolationWindow<ForecastProductTimeSlices[K]>
): void {
  const mutableProducts = products as Record<
    ForecastProductId,
    LoadedInterpolationWindow<ForecastProductTimeSlices[ForecastProductId]>
  >
  mutableProducts[id] = window
}
