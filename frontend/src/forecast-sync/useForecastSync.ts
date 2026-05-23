import type { WeatherMapConfig } from '../config'
import type { ForecastRenderHost } from '../forecast-render'
import { useForecastTimeContext } from '../forecast-time'
import { useStartupController } from './useStartupController'
import { useDataPrefetch } from './useDataPrefetch'
import { useDataTarget } from './useDataTarget'
import { useRequestRunner } from './useRequestRunner'
import type { ForecastSyncStartupStatus } from './types'
import type { FieldInterpolationWindowData } from '../forecast-data'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  pressureContoursEnabled?: boolean
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export type UseForecastSyncResult = {
  startupStatus: ForecastSyncStartupStatus
}

export function useForecastSync({
  renderHost,
  config,
  pressureContoursEnabled = true,
  onProbeFrameChange,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const startup = useStartupController()
  const target = useDataTarget(startup.retryToken)
  const { syncCallbacks } = useForecastTimeContext()

  useRequestRunner({
    renderHost,
    config,
    target,
    syncCallbacks,
    startup,
    pressureContoursEnabled,
    onProbeFrameChange,
  })
  useDataPrefetch({
    config,
    target,
    enabled: !startup.isBlocked,
    pressureContoursEnabled,
  })

  return {
    startupStatus: startup.status,
  }
}
