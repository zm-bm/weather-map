import type { WeatherMapConfig } from '../config'
import type { ForecastRenderHost } from '../forecast-render'
import { useForecastTimeContext } from '../forecast-time'
import { useStartupState } from './useStartupState'
import { useForecastDataPrefetch } from './useForecastDataPrefetch'
import { useForecastDataTarget } from './useForecastDataTarget'
import { useSyncRunner } from './useSyncRunner'
import type { ForecastSyncStartupStatus } from './types'
import type { FieldInterpolationWindowData } from '../forecast-data'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  pressureContoursEnabled?: boolean
}

export type UseForecastSyncResult = {
  startupStatus: ForecastSyncStartupStatus
  appliedProbeField: FieldInterpolationWindowData | null
}

export function useForecastSync({
  renderHost,
  config,
  pressureContoursEnabled = true,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const startup = useStartupState()
  const target = useForecastDataTarget(startup.retryToken)
  const { syncCallbacks } = useForecastTimeContext()

  const { appliedProbeField } = useSyncRunner({
    renderHost,
    config,
    target,
    syncCallbacks,
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
    appliedProbeField,
  }
}
