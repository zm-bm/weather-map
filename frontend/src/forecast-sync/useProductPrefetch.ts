import { useEffect } from 'react'

import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import { createForecastProductRequest, prefetchForecastProducts } from '../forecast-products'
import type { ForecastProductOptions, ForecastProductTarget } from '../forecast-products'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseForecastProductPrefetchArgs = {
  config: WeatherMapConfig
  target: ForecastProductTarget | null
  enabled: boolean
  productOptions: ForecastProductOptions
}

export function useProductPrefetch({
  config,
  target,
  enabled,
  productOptions,
}: UseForecastProductPrefetchArgs): void {
  useEffect(() => {
    if (!enabled || target == null) return

    const controller = new AbortController()
    const request = createForecastProductRequest({
      target,
      artifacts: createArtifactLoader({
        config,
        activeRun: target.activeRun,
        signal: controller.signal,
      }),
      retryToken: 0,
      options: productOptions,
    })

    void prefetchForecastProducts({
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
  }, [config, enabled, productOptions, target])
}
