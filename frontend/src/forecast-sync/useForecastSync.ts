import type { WeatherMapConfig } from '../config'
import type { ForecastRenderHost } from '../forecast-render'
import { useStartupState } from './useStartupState'
import { useForecastDataPrefetch } from './useForecastDataPrefetch'
import { useSyncTarget } from './useSyncTarget'
import { useSyncRunner } from './useSyncRunner'
import type { ForecastSyncStartupStatus } from './types'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  pressureContoursEnabled?: boolean
}

export type UseForecastSyncResult = {
  startupStatus: ForecastSyncStartupStatus
}

export function useForecastSync({
  renderHost,
  config,
  pressureContoursEnabled = true,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const startup = useStartupState()
  const target = useSyncTarget(startup.retryToken)

  useSyncRunner({
    renderHost,
    config,
    target,
    startup,
    pressureContoursEnabled,
  })
  useForecastDataPrefetch({
    config,
    target,
    enabled: !startup.isBlocked,
    pressureContoursEnabled,
  })

  return {
    startupStatus: startup.status,
  }
}
