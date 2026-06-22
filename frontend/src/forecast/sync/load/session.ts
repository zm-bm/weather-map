import type { WeatherMapConfig } from '@/core/config'
import { createArtifactLoader } from '@/forecast/artifacts'
import type { ForecastWindowId, ForecastFrameMap } from '@/forecast/frames'
import type { ForecastWindows } from '@/forecast/frames'
import type { FrameWindow } from '@/forecast/frames'
import { prefetchForecastFrames } from './prefetch'
import type { ForecastSyncPlan, ForecastWindowPlan } from '../plan'
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
  windowKeys: WindowKeyMap
  windows: ForecastWindows
}

type WindowKeyMap = Partial<Record<ForecastWindowId, string>>

export type ForecastSyncSession = {
  createLoadJob: (args: CreateLoadJobArgs) => LoadJob
  prefetch: (args: PrefetchArgs) => Promise<void>
  reset: () => void
}

export function createForecastSyncSession(): ForecastSyncSession {
  let committed: SessionSnapshot | null = null

  return {
    createLoadJob(args) {
      const windowKeys = keysByWindowId(args.plan.windowPlans)
      const artifacts = createArtifactLoader({
        config: args.config,
        activeRun: args.plan.activeRun,
        signal: args.signal,
      })
      return {
        key: createSyncRequestKey(args.plan, args.retryToken),
        selectedValidTimeMs: args.plan.selectedValidTimeMs,
        shouldClearProbeFrame: shouldClearProbeFrame(committed, windowKeys),
        load: () => loadWindows({
          selection: args.plan,
          windowPlans: args.plan.windowPlans,
          artifacts,
          previousWindows: reusableWindowsFor(committed, args.plan.windowPlans, windowKeys),
        }),
        commit(windows) {
          committed = { windowKeys, windows }
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
  windowPlans: readonly ForecastWindowPlan[],
  windowKeys: WindowKeyMap
): ForecastWindows {
  if (committed == null) return {}

  const reusableWindows: ForecastWindows = {}
  const mutableWindows = reusableWindows as Record<
    ForecastWindowId,
    FrameWindow<ForecastFrameMap[ForecastWindowId]>
  >
  for (const windowPlan of windowPlans) {
    if (committed.windowKeys[windowPlan.id] !== windowKeys[windowPlan.id]) continue
    const window = committed.windows[windowPlan.id]
    if (window == null) continue
    mutableWindows[windowPlan.id] = window
  }
  return reusableWindows
}

function shouldClearProbeFrame(
  committed: SessionSnapshot | null,
  windowKeys: WindowKeyMap
): boolean {
  return committed != null &&
    rasterWindowKey(committed.windowKeys) !== rasterWindowKey(windowKeys)
}

function createSyncRequestKey(
  plan: ForecastSyncPlan,
  retryToken: number
): string {
  return [
    windowSetKey(plan.windowPlans),
    plan.lowerFrameId,
    plan.upperFrameId,
    plan.minuteOffset,
    retryToken,
  ].join(':')
}

function keysByWindowId(windowPlans: readonly ForecastWindowPlan[]): WindowKeyMap {
  return Object.fromEntries(
    windowPlans.map((windowPlan) => [windowPlan.id, windowPlan.key])
  ) as WindowKeyMap
}

function windowSetKey(windowPlans: readonly ForecastWindowPlan[]): string {
  return windowPlans.map((windowPlan) => windowPlan.key).join('|')
}

function rasterWindowKey(windowKeys: WindowKeyMap): string | null {
  return windowKeys.raster ?? null
}
