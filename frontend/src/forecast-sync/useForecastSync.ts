import type { Map as MapLibreMap } from 'maplibre-gl'

import type { WeatherMapConfig } from '../config'
import { useStartupAppStatus } from './useStartupAppStatus'
import { useStartupState } from './useStartupState'
import { useSyncRequest } from './useSyncRequest'
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
  const request = useSyncRequest(startup.retryToken)

  useSyncRunner({
    getMap,
    mapReadyVersion,
    config,
    request,
    startup,
  })
  useStartupAppStatus(startup.status)
}
