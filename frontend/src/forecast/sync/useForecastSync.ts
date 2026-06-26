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

type PrefetchRequest = {
  key: string
  plan: ForecastSyncPlan
  aheadFrameCount: number
}

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
  const prefetchRequest = useStablePrefetchRequest(plan, syncOptions)

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
    if (initialSync.isBlocked || prefetchRequest == null) return

    const controller = new AbortController()
    void syncSession.prefetch({
      plan: prefetchRequest.plan,
      config,
      signal: controller.signal,
      aheadFrameCount: prefetchRequest.aheadFrameCount,
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
    prefetchRequest,
  ])

  return {
    initialStatus: initialSync.status,
  }
}

function useStablePrefetchRequest(
  plan: ForecastSyncPlan | null,
  syncOptions: ForecastSyncOptions
): PrefetchRequest | null {
  const previousRequestRef = useRef<PrefetchRequest | null>(null)

  return useMemo(() => {
    if (plan == null) {
      previousRequestRef.current = null
      return null
    }

    const key = prefetchRequestKey(plan, syncOptions)
    const aheadFrameCount = resolvePrefetchAheadFrameCount(plan)
    const previous = previousRequestRef.current
    if (previous?.key === key && previous.aheadFrameCount === aheadFrameCount) {
      return previous
    }

    const nextRequest = { key, plan, aheadFrameCount }
    previousRequestRef.current = nextRequest
    return nextRequest
  }, [plan, syncOptions])
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
