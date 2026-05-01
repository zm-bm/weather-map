import { useEffect } from 'react'

import type { WeatherMapConfig } from '../config'
import { prefetchForecastFrames } from '../forecast-frame'
import type { SyncRequest } from './types'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseFramePrefetchArgs = {
  config: WeatherMapConfig
  request: SyncRequest | null
  enabled: boolean
}

export function useFramePrefetch({
  config,
  request,
  enabled,
}: UseFramePrefetchArgs): void {
  useEffect(() => {
    if (!enabled || request == null) return

    const controller = new AbortController()

    void prefetchForecastFrames({
      config,
      manifest: request.manifest,
      activeScalar: request.activeScalar,
      activeVector: request.activeVector,
      lowerHourToken: request.lowerHourToken,
      upperHourToken: request.upperHourToken,
      aheadHourCount: PREFETCH_AHEAD_HOUR_COUNT,
      concurrency: PREFETCH_CONCURRENCY,
      signal: controller.signal,
    }).catch(() => {
      // Prefetch is opportunistic; rendering sync owns user-visible errors.
    })

    return () => {
      controller.abort()
    }
  }, [config, enabled, request])
}
