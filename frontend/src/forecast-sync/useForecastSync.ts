import type { WeatherMapConfig } from '../config'
import type { ForecastRenderHost } from '../forecast-render'
import { useStartupAppStatus } from './useStartupAppStatus'
import { useStartupState } from './useStartupState'
import { useForecastDataPrefetch } from './useForecastDataPrefetch'
import { useSyncTarget } from './useSyncTarget'
import { useSyncRunner } from './useSyncRunner'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
}

export function useForecastSync({
  renderHost,
  config,
}: UseForecastSyncArgs): void {
  const startup = useStartupState()
  const target = useSyncTarget(startup.retryToken)

  useSyncRunner({
    renderHost,
    config,
    target,
    startup,
  })
  useForecastDataPrefetch({
    config,
    target,
    enabled: !startup.isBlocked,
  })
  useStartupAppStatus(startup.status)
}
