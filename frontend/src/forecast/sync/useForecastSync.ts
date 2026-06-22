import { useEffect, useMemo } from 'react'

import type { WeatherMapConfig } from '@/core/config'
import type { ProbeWindow } from '@/forecast/frames'
import type { ForecastRenderHost } from '@/forecast/render'
import { useForecastSelectionContext } from '@/forecast/selection'
import { useForecastTimeContext } from '@/forecast/time'
import { useInitialSyncController, type ForecastSyncInitialStatus } from './request/initialSync'
import { createForecastSyncSession } from './load/session'
import { resolveForecastSyncPlan, type ForecastSyncOptions } from './plan'
import { useRequestRunner } from './request/useRequestRunner'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

export type UseForecastSyncArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  syncOptions: ForecastSyncOptions
  onProbeFrameChange?: (frame: ProbeWindow | null) => void
  onFieldLoadingChange?: (isLoading: boolean) => void
}

export type UseForecastSyncResult = {
  initialStatus: ForecastSyncInitialStatus
}

export function useForecastSync({
  renderHost,
  config,
  syncOptions,
  onProbeFrameChange,
  onFieldLoadingChange,
}: UseForecastSyncArgs): UseForecastSyncResult {
  const initialSync = useInitialSyncController()

  const {
    activeRun,
    selectedLayerId,
    selectedParticleLayerId,
  } = useForecastSelectionContext()

  const {
    state: timelineState,
    syncCallbacks,
  } = useForecastTimeContext()

  const plan = useMemo(() => resolveForecastSyncPlan({
    activeRun,
    selectedLayerId,
    selectedParticleLayerId,
    syncOptions,
    targetTimeMs: timelineState.targetTimeMs,
  }), [
    activeRun,
    syncOptions,
    selectedLayerId,
    selectedParticleLayerId,
    timelineState.targetTimeMs,
  ])

  const syncSession = useMemo(() => createForecastSyncSession(), [])

  useRequestRunner({
    renderHost,
    config,
    plan,
    syncCallbacks,
    initialSync,
    syncSession,
    onProbeFrameChange,
    onFieldLoadingChange,
  })

  useEffect(() => {
    if (initialSync.isBlocked || plan == null) return

    const controller = new AbortController()
    void syncSession.prefetch({
      plan,
      config,
      signal: controller.signal,
      aheadHourCount: PREFETCH_AHEAD_HOUR_COUNT,
      concurrency: PREFETCH_CONCURRENCY,
    }).catch(() => {
      // Prefetch is opportunistic; rendering sync owns user-visible errors.
    })

    return () => {
      controller.abort()
    }
  }, [
    config,
    initialSync.isBlocked,
    syncSession,
    plan,
  ])

  return {
    initialStatus: initialSync.status,
  }
}
