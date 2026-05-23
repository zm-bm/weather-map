import { useState } from 'react'

import type { WeatherMapConfig } from '../config'
import {
  createForecastDataSession,
  type ForecastDataOptions,
  type FieldInterpolationWindowData,
  type ForecastDataSession,
} from '../forecast-data'
import type { ForecastRenderHost } from '../forecast-render'
import { useForecastTimeContext } from '../forecast-time'
import { useStartupController } from './useStartupController'
import { useDataPrefetch } from './useDataPrefetch'
import { useDataTarget } from './useDataTarget'
import { useRequestRunner } from './useRequestRunner'
import type { ForecastSyncStartupStatus } from './types'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  dataOptions: ForecastDataOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export type UseForecastSyncResult = {
  startupStatus: ForecastSyncStartupStatus
}

export function useForecastSync({
  renderHost,
  config,
  dataOptions,
  onProbeFrameChange,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const startup = useStartupController()
  const target = useDataTarget()
  const { syncCallbacks } = useForecastTimeContext()
  const [dataSession] = useState<ForecastDataSession>(() => createForecastDataSession())

  useRequestRunner({
    renderHost,
    config,
    target,
    syncCallbacks,
    startup,
    dataSession,
    dataOptions,
    onProbeFrameChange,
  })
  useDataPrefetch({
    config,
    target,
    enabled: !startup.isBlocked,
    dataSession,
    dataOptions,
  })

  return {
    startupStatus: startup.status,
  }
}
