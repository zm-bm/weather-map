import type { ReadonlyNonEmptyArray } from '@/core/types'
import {
  forecastRasterLayerSourceFromLayer,
  getAvailableParticleLayer,
  getAvailableRasterLayer,
  getDefaultAvailableContourLayer,
  sourceBandIds,
  type ContourLayer,
  type ForecastLayerSource,
  type LoadSource,
  type ParticleLayer,
} from '@/forecast/catalog'
import {
  canLoadRasterBandsForRun,
  type RasterBandOrder,
} from '@/forecast/artifacts'
import type { ForecastWindowId } from '@/forecast/frames'
import type { ActiveForecastRun } from '@/forecast/manifest'
import {
  forecastRunScopeKey,
  normalizeFrameId,
} from '@/forecast/manifest'
import {
  interpolationWindowMinuteOffset,
  resolveForecastInterpolationWindow,
  type ForecastTimeSliceSelection,
} from '@/forecast/time'

const NO_WINDOW_PLAN_KEY = 'data:none'

export type ForecastWindowFailurePolicy = 'required' | 'optional'

export type RasterFramePlan = {
  source: unknown
  artifactId: string
  bandIds: ReadonlyNonEmptyArray<string>
  cacheKeyPrefix: string
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}

type SingleForecastWindowPlan = {
  id: ForecastWindowId
  key: string
  failurePolicy: ForecastWindowFailurePolicy
  output: 'single'
  frames: readonly [RasterFramePlan]
}

type ArrayForecastWindowPlan = {
  id: 'overlay'
  key: string
  failurePolicy: ForecastWindowFailurePolicy
  output: 'array'
  frames: ReadonlyNonEmptyArray<RasterFramePlan>
}

export type ForecastWindowPlan = SingleForecastWindowPlan | ArrayForecastWindowPlan

export type WindowPlanKeyMap = Partial<Record<ForecastWindowId, string>>

export type ForecastSyncOptions = {
  contour: boolean
  particles: boolean
}

export const DEFAULT_FORECAST_SYNC_OPTIONS: ForecastSyncOptions = {
  contour: true,
  particles: true,
}

export type ForecastSyncPlan = ForecastTimeSliceSelection & {
  activeRun: ActiveForecastRun
  frameIds: readonly string[]
  windowPlans: readonly ForecastWindowPlan[]
  windowPlanKeys: WindowPlanKeyMap
  windowPlanSetKey: string
  minuteOffset: number
}

export type ResolveForecastSyncPlanArgs = {
  activeRun: ActiveForecastRun | null
  selectedLayerId: string | null
  selectedParticleLayerId: string | null
  targetTimeMs: number
  syncOptions: ForecastSyncOptions
}

export function resolveForecastSyncPlan(args: ResolveForecastSyncPlanArgs): ForecastSyncPlan | null {
  const selectedLayer = getAvailableRasterLayer(args.activeRun, args.selectedLayerId)
  if (args.activeRun == null || selectedLayer == null) return null

  const selectedContourLayer = args.syncOptions.contour
    ? getDefaultAvailableContourLayer(args.activeRun)
    : null
  const selectedParticleLayer = args.syncOptions.particles
    ? getAvailableParticleLayer(args.activeRun, args.selectedParticleLayerId)
    : null
  const interpolationWindow = resolveForecastInterpolationWindow(
    args.activeRun.latest.frames,
    args.targetTimeMs
  )
  const runScope = forecastRunScopeKey(args.activeRun)
  const layerSource = forecastRasterLayerSourceFromLayer(selectedLayer)
  const windowPlans = createWindowPlans({
    activeRun: args.activeRun,
    layerSource,
    contourLayer: selectedContourLayer,
    particleLayer: selectedParticleLayer,
    runScope,
  })

  return {
    activeRun: args.activeRun,
    frameIds: args.activeRun.latest.frames.map((time) => (
      normalizeFrameId(time.id)
    )),
    windowPlans,
    windowPlanKeys: windowPlanKeysById(windowPlans),
    windowPlanSetKey: windowPlanSetKeyString(runScope, windowPlans),
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerFrameId: normalizeFrameId(interpolationWindow.lowerFrameId),
    upperFrameId: normalizeFrameId(interpolationWindow.upperFrameId),
    mix: interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(interpolationWindow),
  }
}

function createWindowPlans(args: {
  activeRun: ActiveForecastRun
  layerSource: ForecastLayerSource
  contourLayer: ContourLayer | null
  particleLayer: ParticleLayer | null
  runScope: string
}): ForecastWindowPlan[] {
  const plans: ForecastWindowPlan[] = []

  plans.push(singleWindowPlan({
    id: 'raster',
    failurePolicy: 'required',
    frame: rasterFramePlan({
      runScope: args.runScope,
      id: 'raster',
      sourceId: args.layerSource.layerId,
      source: args.layerSource,
      loadSource: args.layerSource,
    }),
  }))

  if (args.layerSource.overlays.length > 0) {
    const frames = args.layerSource.overlays.flatMap((source) => {
      const frame = rasterFramePlan({
        runScope: args.runScope,
        id: 'overlay',
        sourceId: source.id,
        source,
        loadSource: source.source,
        order: 'by-name',
        failurePolicy: source.optional ? 'optional' : 'required',
      })
      return frame.failurePolicy === 'optional' &&
        !canLoadRasterBandsForRun(
          args.activeRun,
          frame.artifactId,
          frame.bandIds,
          { order: frame.order }
        )
        ? []
        : [frame]
    })

    if (isNonEmpty(frames)) {
      plans.push(overlayWindowPlan({
        runScope: args.runScope,
        frames,
      }))
    }
  }

  if (args.contourLayer != null) {
    plans.push(singleWindowPlan({
      id: 'contour',
      failurePolicy: 'optional',
      frame: rasterFramePlan({
        runScope: args.runScope,
        id: 'contour',
        sourceId: args.contourLayer.id,
        source: frameSourceFromCatalogEntry(args.contourLayer),
        loadSource: args.contourLayer.source,
      }),
    }))
  }

  if (args.particleLayer != null) {
    plans.push(singleWindowPlan({
      id: 'particles',
      failurePolicy: 'required',
      frame: rasterFramePlan({
        runScope: args.runScope,
        id: 'particles',
        sourceId: args.particleLayer.id,
        source: frameSourceFromCatalogEntry(args.particleLayer),
        loadSource: args.particleLayer.source,
      }),
    }))
  }

  return plans
}

function singleWindowPlan(args: {
  id: ForecastWindowId
  failurePolicy: ForecastWindowFailurePolicy
  frame: RasterFramePlan
}): ForecastWindowPlan {
  return {
    id: args.id,
    key: args.frame.cacheKeyPrefix,
    failurePolicy: args.failurePolicy,
    output: 'single',
    frames: [args.frame],
  }
}

function overlayWindowPlan(args: {
  runScope: string
  frames: ReadonlyNonEmptyArray<RasterFramePlan>
}): ForecastWindowPlan {
  return {
    id: 'overlay',
    key: `${args.runScope}:overlay:${args.frames.map((frame) => frame.cacheKeyPrefix).join('+')}`,
    failurePolicy: 'optional',
    output: 'array',
    frames: args.frames,
  }
}

function frameSourceFromCatalogEntry(entry: ContourLayer | ParticleLayer) {
  return {
    id: entry.id,
    source: entry.source,
  }
}

function rasterFramePlan(args: {
  runScope: string
  id: ForecastWindowId
  sourceId: string
  source: unknown
  loadSource: LoadSource
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}): RasterFramePlan {
  const bandIds = sourceBandIds(args.loadSource)
  const cacheKeyPrefix = sourceKey({
    runScope: args.runScope,
    id: args.id,
    sourceId: args.sourceId,
    artifactId: args.loadSource.artifactId,
    bandIds,
  })
  return {
    source: args.source,
    artifactId: args.loadSource.artifactId,
    bandIds,
    cacheKeyPrefix,
    ...(args.order === undefined ? {} : { order: args.order }),
    ...(args.failurePolicy === undefined ? {} : { failurePolicy: args.failurePolicy }),
  }
}

function isNonEmpty<T>(items: readonly T[]): items is ReadonlyNonEmptyArray<T> {
  return items.length > 0
}

function windowPlanKeysById(windowPlans: readonly ForecastWindowPlan[]): WindowPlanKeyMap {
  return Object.fromEntries(
    windowPlans.map((windowPlan) => [windowPlan.id, windowPlan.key])
  ) as WindowPlanKeyMap
}

function windowPlanSetKeyString(
  runScope: string,
  windowPlans: readonly ForecastWindowPlan[],
): string {
  return windowPlans.length === 0
    ? `${runScope}:${NO_WINDOW_PLAN_KEY}`
    : windowPlans.map((windowPlan) => windowPlan.key).join('|')
}

function sourceKey(args: {
  runScope: string
  id: string
  sourceId: string
  artifactId: string
  bandIds: readonly string[]
}): string {
  return `${args.runScope}:${args.id}:${args.sourceId}:${args.artifactId}:${args.bandIds.join('+')}`
}
