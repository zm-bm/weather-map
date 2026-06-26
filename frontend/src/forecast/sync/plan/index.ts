import type { ReadonlyNonEmptyArray } from '@/core/types'
import {
  forecastRasterLayerSourceFromLayer,
  getAvailableParticleLayer,
  getDefaultAvailableContourLayer,
  getDefaultAvailableParticleLayerId,
  resolveRenderableRasterLayer,
  sourceBandIds,
  type ArtifactSource,
  type ContourLayer,
  type ForecastLayerSource,
  type OverlaySource,
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
  type ForecastFrameSelection,
} from '@/forecast/time'

export type ForecastWindowFailurePolicy = 'required' | 'optional'

type ForecastPlanSource =
  ForecastLayerSource |
  OverlaySource |
  ContourLayer |
  ParticleLayer

export type ForecastFramePlan = {
  source: ForecastPlanSource
  artifactId: string
  bandIds: ReadonlyNonEmptyArray<string>
  cacheKeyPrefix: string
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}

export type ForecastWindowPlan = {
  id: ForecastWindowId
  key: string
  failurePolicy: ForecastWindowFailurePolicy
  frames: ReadonlyNonEmptyArray<ForecastFramePlan>
}

export type ForecastSyncOptions = {
  contour: boolean
  particles: boolean
}

export type ForecastSyncPlan = ForecastFrameSelection & {
  activeRun: ActiveForecastRun
  frameIds: readonly string[]
  windowPlans: readonly ForecastWindowPlan[]
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
    ? getSelectedOrDefaultParticleLayer(args.activeRun, args.selectedParticleLayerId)
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
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerFrameId: normalizeFrameId(interpolationWindow.lowerFrameId),
    upperFrameId: normalizeFrameId(interpolationWindow.upperFrameId),
    mix: interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(interpolationWindow),
  }
}

function getSelectedOrDefaultParticleLayer(
  activeRun: ActiveForecastRun,
  selectedLayerId: string | null
): ParticleLayer | null {
  return getAvailableParticleLayer(activeRun, selectedLayerId) ??
    getAvailableParticleLayer(activeRun, getDefaultAvailableParticleLayerId(activeRun))
}

function createWindowPlans(args: {
  activeRun: ActiveForecastRun
  layerSource: ForecastLayerSource
  contourLayer: ContourLayer | null
  particleLayer: ParticleLayer | null
  runScope: string
}): ForecastWindowPlan[] {
  const plans: ForecastWindowPlan[] = []

  const rasterFrame = forecastFramePlan(
    args.runScope,
    'raster',
    args.layerSource.layerId,
    args.layerSource,
    args.layerSource,
  )
  plans.push({
    id: 'raster',
    key: rasterFrame.cacheKeyPrefix,
    failurePolicy: 'required',
    frames: [rasterFrame],
  })

  if (args.layerSource.overlays.length > 0) {
    const frames = args.layerSource.overlays.flatMap((source) => {
      const frame = forecastFramePlan(
        args.runScope,
        'overlay',
        source.id,
        source,
        source.source,
        {
          order: 'by-name',
          failurePolicy: source.optional ? 'optional' : 'required',
        }
      )
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
      plans.push({
        id: 'overlay',
        key: `${args.runScope}:overlay:${frames.map((frame) => frame.cacheKeyPrefix).join('+')}`,
        failurePolicy: 'optional',
        frames,
      })
    }
  }

  if (args.contourLayer != null) {
    const contourFrame = forecastFramePlan(
      args.runScope,
      'contour',
      args.contourLayer.id,
      args.contourLayer,
      args.contourLayer.source,
    )
    plans.push({
      id: 'contour',
      key: contourFrame.cacheKeyPrefix,
      failurePolicy: 'optional',
      frames: [contourFrame],
    })
  }

  if (args.particleLayer != null) {
    const particleFrame = forecastFramePlan(
      args.runScope,
      'particles',
      args.particleLayer.id,
      args.particleLayer,
      args.particleLayer.source,
    )
    plans.push({
      id: 'particles',
      key: particleFrame.cacheKeyPrefix,
      failurePolicy: 'required',
      frames: [particleFrame],
    })
  }

  return plans
}

function forecastFramePlan(
  runScope: string,
  windowId: ForecastWindowId,
  sourceId: string,
  source: ForecastPlanSource,
  loadSource: ArtifactSource,
  options: {
    order?: RasterBandOrder
    failurePolicy?: ForecastWindowFailurePolicy
  } = {},
): ForecastFramePlan {
  const bandIds = sourceBandIds(loadSource)
  const cacheKeyPrefix = sourceKey({
    runScope,
    id: windowId,
    sourceId,
    artifactId: loadSource.artifactId,
    bandIds,
  })
  return {
    source,
    artifactId: loadSource.artifactId,
    bandIds,
    cacheKeyPrefix,
    ...(options.order === undefined ? {} : { order: options.order }),
    ...(options.failurePolicy === undefined ? {} : { failurePolicy: options.failurePolicy }),
  }
}

function isNonEmpty<T>(items: readonly T[]): items is ReadonlyNonEmptyArray<T> {
  return items.length > 0
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
