import type { WeatherMapConfig } from '@/core/config'
import { createArtifactLoader } from '@/forecast/artifacts'
import type { ForecastWindowId, ForecastFrameMap } from '@/forecast/frames'
import type { ForecastWindows } from '@/forecast/frames'
import type { FrameWindow } from '@/forecast/frames'
import { prefetchForecastFrames } from './prefetch'
import type { ForecastSyncPlan, WindowPlanKeyMap } from '../plan'
import { loadWindows } from './windowLoader'

type CreateLoadJobArgs = {
  plan: ForecastSyncPlan
  config: WeatherMapConfig
  signal: AbortSignal
  retryToken: number
}

type PrefetchArgs = {
  plan: ForecastSyncPlan
  config: WeatherMapConfig
  signal: AbortSignal
  aheadHourCount: number
  concurrency: number
}

type LoadJob = {
  key: string
  selectedValidTimeMs: number
  shouldClearProbeFrame: boolean
  load: () => Promise<ForecastWindows>
  commit: (windows: ForecastWindows) => void
}

type SessionSnapshot = {
  windowPlanKeys: WindowPlanKeyMap
  windows: ForecastWindows
}

export type ForecastSyncSession = {
  createLoadJob: (args: CreateLoadJobArgs) => LoadJob
  prefetch: (args: PrefetchArgs) => Promise<void>
  reset: () => void
}

export function createForecastSyncSession(): ForecastSyncSession {
  let committed: SessionSnapshot | null = null

  return {
    createLoadJob(args) {
      const artifacts = createArtifactLoader({
        config: args.config,
        activeRun: args.plan.activeRun,
        signal: args.signal,
      })
      return {
        key: createSyncRequestKey(args.plan, args.retryToken),
        selectedValidTimeMs: args.plan.selectedValidTimeMs,
        shouldClearProbeFrame: shouldClearProbeFrame(committed, args.plan),
        load: () => loadWindows({
          selection: args.plan,
          windowPlans: args.plan.windowPlans,
          artifacts,
          previousWindows: reusableWindowsFor(committed, args.plan),
        }),
        commit(windows) {
          committed = createSessionSnapshot(args.plan, windows)
        },
      }
    },
    prefetch(args) {
      const artifacts = createArtifactLoader({
        config: args.config,
        activeRun: args.plan.activeRun,
        signal: args.signal,
      })
      return prefetchForecastFrames({
        windowPlans: args.plan.windowPlans,
        artifacts,
        lowerFrameId: args.plan.lowerFrameId,
        upperFrameId: args.plan.upperFrameId,
        frameIds: args.plan.frameIds,
        aheadHourCount: args.aheadHourCount,
        concurrency: args.concurrency,
        signal: args.signal,
      })
    },
    reset() {
      committed = null
    },
  }
}

function reusableWindowsFor(
  committed: SessionSnapshot | null,
  plan: ForecastSyncPlan
): ForecastWindows {
  if (committed == null) return {}

  const reusableWindows: ForecastWindows = {}
  const mutableWindows = reusableWindows as Record<
    ForecastWindowId,
    FrameWindow<ForecastFrameMap[ForecastWindowId]>
  >
  for (const windowPlan of plan.windowPlans) {
    if (committed.windowPlanKeys[windowPlan.id] !== windowPlan.key) continue
    const window = committed.windows[windowPlan.id]
    if (window == null) continue
    mutableWindows[windowPlan.id] = window
  }
  return reusableWindows
}

function shouldClearProbeFrame(
  committed: SessionSnapshot | null,
  plan: ForecastSyncPlan
): boolean {
  return committed != null &&
    rasterWindowPlanKey(committed.windowPlanKeys) !== rasterWindowPlanKey(plan.windowPlanKeys)
}

function createSessionSnapshot(
  plan: ForecastSyncPlan,
  windows: ForecastWindows
): SessionSnapshot {
  return {
    windowPlanKeys: plan.windowPlanKeys,
    windows,
  }
}

function createSyncRequestKey(
  plan: ForecastSyncPlan,
  retryToken: number
): string {
  return [
    plan.windowPlanSetKey,
    plan.lowerFrameId,
    plan.upperFrameId,
    plan.minuteOffset,
    retryToken,
  ].join(':')
}

function rasterWindowPlanKey(windowPlanKeys: WindowPlanKeyMap): string | null {
  return windowPlanKeys.raster ?? null
}
