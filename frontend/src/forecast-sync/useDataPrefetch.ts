import { useEffect } from 'react'

import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import { createForecastDataRequest, prefetchForecastData } from '../forecast-data'
import type { ForecastDataOptions } from '../forecast-data'
import type { ForecastDataTarget } from '../forecast-data-targets'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseForecastDataPrefetchArgs = {
  config: WeatherMapConfig
  target: ForecastDataTarget | null
  enabled: boolean
  dataOptions: ForecastDataOptions
}

export function useDataPrefetch({
  config,
  target,
  enabled,
  dataOptions,
}: UseForecastDataPrefetchArgs): void {
  useEffect(() => {
    if (!enabled || target == null) return

    const controller = new AbortController()
    const request = createForecastDataRequest({
      target,
      artifacts: createArtifactLoader({
        config,
        activeRun: target.activeRun,
        signal: controller.signal,
      }),
      retryToken: 0,
      options: dataOptions,
    })

    void prefetchForecastData({
      request,
      aheadHourCount: PREFETCH_AHEAD_HOUR_COUNT,
      concurrency: PREFETCH_CONCURRENCY,
      signal: controller.signal,
    }).catch(() => {
      // Prefetch is opportunistic; rendering sync owns user-visible errors.
    })

    return () => {
      controller.abort()
    }
  }, [config, enabled, dataOptions, target])
}
