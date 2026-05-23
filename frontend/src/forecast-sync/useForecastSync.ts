import type { WeatherMapConfig } from '../config'
import type { ForecastProductOptions, FieldInterpolationWindowData } from '../forecast-products'
import type { ForecastRenderHost } from '../forecast-render'
import { useForecastTimeContext } from '../forecast-time'
import { useStartupController } from './useStartupController'
import { useProductPrefetch } from './useProductPrefetch'
import { useProductTarget } from './useProductTarget'
import { useRequestRunner } from './useRequestRunner'
import type { ForecastSyncStartupStatus } from './types'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  productOptions: ForecastProductOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export type UseForecastSyncResult = {
  startupStatus: ForecastSyncStartupStatus
}

export function useForecastSync({
  renderHost,
  config,
  productOptions,
  onProbeFrameChange,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const startup = useStartupController()
  const target = useProductTarget()
  const { syncCallbacks } = useForecastTimeContext()

  useRequestRunner({
    renderHost,
    config,
    target,
    syncCallbacks,
    startup,
    productOptions,
    onProbeFrameChange,
  })
  useProductPrefetch({
    config,
    target,
    enabled: !startup.isBlocked,
    productOptions,
  })

  return {
    startupStatus: startup.status,
  }
}
