import { useEffect } from 'react'

import type { WeatherMapConfig } from '@/core/config'
import type { ForecastDataOptions, ForecastDataSession, ForecastDataTarget } from '@/forecast/data'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseForecastDataPrefetchArgs = {
  config: WeatherMapConfig
  target: ForecastDataTarget | null
  enabled: boolean
  dataSession: ForecastDataSession
  dataOptions: ForecastDataOptions
}

export function useDataPrefetch({
  config,
  target,
  enabled,
  dataSession,
  dataOptions,
}: UseForecastDataPrefetchArgs): void {
  useEffect(() => {
    if (!enabled || target == null) return

    const controller = new AbortController()
    void dataSession.prefetch({
      target,
      config,
      signal: controller.signal,
      options: dataOptions,
      aheadHourCount: PREFETCH_AHEAD_HOUR_COUNT,
      concurrency: PREFETCH_CONCURRENCY,
    }).catch(() => {
      // Prefetch is opportunistic; rendering sync owns user-visible errors.
    })

    return () => {
      controller.abort()
    }
  }, [config, enabled, dataOptions, dataSession, target])
}
