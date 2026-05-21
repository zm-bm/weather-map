import { useEffect } from 'react'

import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import { createForecastDataPlan, prefetchForecastData } from '../forecast-data'
import type { ForecastSyncTarget } from './types'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseForecastDataPrefetchArgs = {
  config: WeatherMapConfig
  target: ForecastSyncTarget | null
  enabled: boolean
  pressureContoursEnabled?: boolean
}

export function useForecastDataPrefetch({
  config,
  target,
  enabled,
  pressureContoursEnabled = true,
}: UseForecastDataPrefetchArgs): void {
  useEffect(() => {
    if (!enabled || target == null) return

    const controller = new AbortController()
    const plan = createForecastDataPlan({
      target,
      artifacts: createArtifactLoader({
        config,
        activeRun: target.activeRun,
        signal: controller.signal,
      }),
      pressureContoursEnabled,
    })

    void prefetchForecastData({
      plan,
      aheadHourCount: PREFETCH_AHEAD_HOUR_COUNT,
      concurrency: PREFETCH_CONCURRENCY,
      signal: controller.signal,
    }).catch(() => {
      // Prefetch is opportunistic; rendering sync owns user-visible errors.
    })

    return () => {
      controller.abort()
    }
  }, [config, enabled, pressureContoursEnabled, target])
}
