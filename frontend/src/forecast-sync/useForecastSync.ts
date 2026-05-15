import type { Map as MapLibreMap } from 'maplibre-gl'

import type { WeatherMapConfig } from '../config'
import { useStartupAppStatus } from './useStartupAppStatus'
import { useStartupState } from './useStartupState'
import { useForecastDataPrefetch } from './useForecastDataPrefetch'
import { useSyncTarget } from './useSyncTarget'
import { useSyncRunner } from './useSyncRunner'

export type UseForecastSyncArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  config: WeatherMapConfig
}

export function useForecastSync({
  getMap,
  mapReadyVersion,
  config,
}: UseForecastSyncArgs): void {
  const startup = useStartupState()
  const target = useSyncTarget(startup.retryToken)

  useSyncRunner({
    getMap,
    mapReadyVersion,
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
