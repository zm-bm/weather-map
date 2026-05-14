import { useEffect } from 'react'

import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import { createForecastFramePlan, prefetchForecastFrames } from '../forecast-frame'
import type { ForecastSyncTarget } from './types'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseFramePrefetchArgs = {
  config: WeatherMapConfig
  target: ForecastSyncTarget | null
  enabled: boolean
}

export function useFramePrefetch({
  config,
  target,
  enabled,
}: UseFramePrefetchArgs): void {
  useEffect(() => {
    if (!enabled || target == null) return

    const controller = new AbortController()
    const plan = createForecastFramePlan({
      target,
      artifacts: createArtifactLoader({
        config,
        manifest: target.manifest,
        signal: controller.signal,
      }),
    })

    void prefetchForecastFrames({
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
  }, [config, enabled, target])
}
