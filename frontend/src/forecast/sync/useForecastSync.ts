import { useEffect, useMemo, useRef } from 'react'

import type { WeatherMapConfig } from '@/core/config'
import type { ProbeWindow } from '@/forecast/frames'
import type { ForecastRenderHost } from '@/forecast/render'
import { useForecastSelectionContext } from '@/forecast/selection'
import { useForecastTimeContext } from '@/forecast/time'
import { forecastRunScopeKey } from '@/forecast/manifest'
import { useInitialSyncController, type ForecastSyncInitialStatus } from './request/initialSync'
import { createForecastSyncSession } from './load/session'
import { resolveForecastSyncPlan, type ForecastSyncOptions, type ForecastSyncPlan } from './plan'
import { useRequestRunner } from './request/useRequestRunner'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_BYTE_BUDGET_BYTES = 32 * 1024 * 1024
const PREFETCH_MIN_AHEAD_FRAME_COUNT = 2
const PREFETCH_MAX_AHEAD_FRAME_COUNT = 8

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
  const prefetchPlanRef = useRef<ForecastSyncPlan | null>(null)
  const prefetchKey = useMemo(() => (
    plan == null ? null : prefetchRequestKey(plan, syncOptions)
  ), [plan, syncOptions])
  const prefetchAheadFrameCount = useMemo(() => (
    plan == null ? null : resolvePrefetchAheadFrameCount(plan)
  ), [plan])

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
    prefetchPlanRef.current = plan
  }, [plan])

  useEffect(() => {
    if (initialSync.isBlocked || prefetchKey == null || prefetchAheadFrameCount == null) return

    const prefetchPlan = prefetchPlanRef.current
    if (prefetchPlan == null) return

    const controller = new AbortController()
    void syncSession.prefetch({
      plan: prefetchPlan,
      config,
      signal: controller.signal,
      aheadFrameCount: prefetchAheadFrameCount,
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
    prefetchKey,
    prefetchAheadFrameCount,
  ])

  return {
    initialStatus: initialSync.status,
  }
}

export function resolvePrefetchAheadFrameCount(plan: ForecastSyncPlan): number {
  const frameByteCost = prefetchFrameByteCost(plan)
  if (frameByteCost <= 0) return PREFETCH_MIN_AHEAD_FRAME_COUNT

  return clampPrefetchAheadFrameCount(
    Math.floor(PREFETCH_BYTE_BUDGET_BYTES / frameByteCost)
  )
}

function prefetchFrameByteCost(plan: ForecastSyncPlan): number {
  const artifactIds = new Set<string>()
  for (const windowPlan of plan.windowPlans) {
    for (const frame of windowPlan.frames) {
      artifactIds.add(frame.artifactId)
    }
  }

  let byteCount = 0
  for (const artifactId of artifactIds) {
    const byteLength = plan.activeRun.latest.artifacts[artifactId]?.byte_length
    if (Number.isFinite(byteLength) && byteLength > 0) {
      byteCount += byteLength
    }
  }
  return byteCount
}

function clampPrefetchAheadFrameCount(value: number): number {
  if (!Number.isFinite(value)) return PREFETCH_MIN_AHEAD_FRAME_COUNT
  return Math.max(
    PREFETCH_MIN_AHEAD_FRAME_COUNT,
    Math.min(PREFETCH_MAX_AHEAD_FRAME_COUNT, Math.trunc(value))
  )
}

function prefetchRequestKey(plan: ForecastSyncPlan, syncOptions: ForecastSyncOptions): string {
  return [
    forecastRunScopeKey(plan.activeRun),
    `contour=${String(syncOptions.contour)}`,
    `particles=${String(syncOptions.particles)}`,
    plan.lowerFrameId,
    plan.upperFrameId,
    plan.frameIds.join(','),
    plan.windowPlans.map((windowPlan) => `${windowPlan.id}:${windowPlan.key}`).join('|'),
  ].join('::')
}
