import type { ReadonlyNonEmptyArray } from '@/core/types'
import {
  forecastRasterLayerSourceFromLayer,
  getAvailableParticleLayer,
  getDefaultAvailableContourLayer,
  resolveRenderableRasterLayer,
  sourceBandIds,
  type ArtifactSource,
  type ContourLayer,
  type ContourSource,
  type ForecastLayerSource,
  type OverlaySource,
  type ParticleLayer,
  type ParticleSource,
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

type ForecastFramePlanSourceMap = {
  raster: ForecastLayerSource
  overlay: OverlaySource
  contour: ContourSource
  particles: ParticleSource
}

type ForecastFramePlanBase<K extends ForecastWindowId> = {
  sourceKind: K
  source: ForecastFramePlanSourceMap[K]
  artifactId: string
  bandIds: ReadonlyNonEmptyArray<string>
  cacheKeyPrefix: string
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}

export type ForecastFramePlan<K extends ForecastWindowId = ForecastWindowId> =
  K extends ForecastWindowId ? ForecastFramePlanBase<K> : never

type SingleForecastWindowId = Exclude<ForecastWindowId, 'overlay'>

type SingleForecastWindowPlan<K extends SingleForecastWindowId = SingleForecastWindowId> =
  K extends SingleForecastWindowId ? {
    id: K
    key: string
    failurePolicy: ForecastWindowFailurePolicy
    output: 'single'
    frames: readonly [ForecastFramePlan<K>]
  } : never

type OverlayForecastWindowPlan = {
  id: 'overlay'
  key: string
  failurePolicy: ForecastWindowFailurePolicy
  output: 'array'
  frames: ReadonlyNonEmptyArray<ForecastFramePlan<'overlay'>>
}

export type ForecastWindowPlan = SingleForecastWindowPlan | OverlayForecastWindowPlan

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
  const renderableLayer = resolveRenderableRasterLayer(args.activeRun, args.selectedLayerId)
  if (args.activeRun == null || renderableLayer == null) return null

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
  const layerSource = forecastRasterLayerSourceFromLayer(renderableLayer.layer)
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
    failurePolicy: 'required',
    frame: forecastFramePlan({
      runScope: args.runScope,
      sourceKind: 'raster',
      sourceId: args.layerSource.layerId,
      source: args.layerSource,
      loadSource: args.layerSource,
    }),
  }))

  if (args.layerSource.overlays.length > 0) {
    const frames = args.layerSource.overlays.flatMap((source) => {
      const frame = forecastFramePlan({
        runScope: args.runScope,
        sourceKind: 'overlay',
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
      failurePolicy: 'optional',
      frame: forecastFramePlan({
        runScope: args.runScope,
        sourceKind: 'contour',
        sourceId: args.contourLayer.id,
        source: contourSourceFromLayer(args.contourLayer),
        loadSource: args.contourLayer.source,
      }),
    }))
  }

  if (args.particleLayer != null) {
    plans.push(singleWindowPlan({
      failurePolicy: 'required',
      frame: forecastFramePlan({
        runScope: args.runScope,
        sourceKind: 'particles',
        sourceId: args.particleLayer.id,
        source: particleSourceFromLayer(args.particleLayer),
        loadSource: args.particleLayer.source,
      }),
    }))
  }

  return plans
}

function singleWindowPlan<K extends SingleForecastWindowId>(args: {
  failurePolicy: ForecastWindowFailurePolicy
  frame: ForecastFramePlan<K>
}): SingleForecastWindowPlan<K> {
  const plan = {
    id: args.frame.sourceKind as K,
    key: args.frame.cacheKeyPrefix,
    failurePolicy: args.failurePolicy,
    output: 'single',
    frames: [args.frame] as readonly [ForecastFramePlan<K>],
  }
  return plan as SingleForecastWindowPlan<K>
}

function overlayWindowPlan(args: {
  runScope: string
  frames: ReadonlyNonEmptyArray<ForecastFramePlan<'overlay'>>
}): OverlayForecastWindowPlan {
  return {
    id: 'overlay',
    key: `${args.runScope}:overlay:${args.frames.map((frame) => frame.cacheKeyPrefix).join('+')}`,
    failurePolicy: 'optional',
    output: 'array',
    frames: args.frames,
  }
}

function contourSourceFromLayer(entry: ContourLayer): ContourSource {
  return {
    id: entry.id,
    source: entry.source,
  }
}

function particleSourceFromLayer(entry: ParticleLayer): ParticleSource {
  return {
    id: entry.id,
    source: entry.source,
  }
}

function forecastFramePlan<K extends ForecastWindowId>(args: {
  runScope: string
  sourceKind: K
  sourceId: string
  source: ForecastFramePlanSourceMap[K]
  loadSource: ArtifactSource
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}): ForecastFramePlan<K> {
  const bandIds = sourceBandIds(args.loadSource)
  const cacheKeyPrefix = sourceKey({
    runScope: args.runScope,
    id: args.sourceKind,
    sourceId: args.sourceId,
    artifactId: args.loadSource.artifactId,
    bandIds,
  })
  return {
    sourceKind: args.sourceKind,
    source: args.source,
    artifactId: args.loadSource.artifactId,
    bandIds,
    cacheKeyPrefix,
    ...(args.order === undefined ? {} : { order: args.order }),
    ...(args.failurePolicy === undefined ? {} : { failurePolicy: args.failurePolicy }),
  } as ForecastFramePlan<K>
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
