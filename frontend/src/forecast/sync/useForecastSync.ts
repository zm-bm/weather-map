import { useMemo } from 'react'

import type { WeatherMapConfig } from '@/core/config'
import {
  createForecastDataSession,
  type ForecastDataOptions,
  type FieldInterpolationWindowData,
} from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import { useForecastTimeContext } from '@/forecast/time'
import { useInitialSyncController, type ForecastSyncInitialStatus } from './initialSync'
import { useDataPrefetch } from './useDataPrefetch'
import { useDataTarget } from './useDataTarget'
import { useRequestRunner } from './useRequestRunner'

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  dataOptions: ForecastDataOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export type UseForecastSyncResult = {
  initialStatus: ForecastSyncInitialStatus
}

export function useForecastSync({
  renderHost,
  config,
  dataOptions,
  onProbeFrameChange,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const initialSync = useInitialSyncController()
  const target = useDataTarget()
  const { syncCallbacks } = useForecastTimeContext()
  const dataSession = useMemo(() => createForecastDataSession(), [])

  useRequestRunner({
    renderHost,
    config,
    target,
    syncCallbacks,
    initialSync,
    dataSession,
    dataOptions,
    onProbeFrameChange,
  })

  useDataPrefetch({
    config,
    target,
    enabled: !initialSync.isBlocked,
    dataSession,
    dataOptions,
  })

  return {
    initialStatus: initialSync.status,
  }
}
