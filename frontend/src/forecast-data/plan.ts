import type { ArtifactLoader } from '../forecast-artifacts'
import type { ActiveForecastRun } from '../forecast-manifest'
import { createCloudLayersChannel } from './cloud-layers'
import { createFieldChannel } from './field'
import { createParticleChannel } from './particles'
import { createPrecipTypeOverlayChannel } from './precip-type-overlay'
import { createPressureContourChannel } from './pressure-contours'
import type { ForecastDataTarget } from './target'
import type {
  FieldTimeSliceData,
  CloudLayersTimeSliceData,
  ForecastDataChannel,
  ParticleTimeSliceData,
  PrecipTypeOverlayTimeSliceData,
  PressureContourTimeSliceData,
} from './types'

export type ForecastDataPlan = {
  activeRun: ActiveForecastRun
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  field: ForecastDataChannel<FieldTimeSliceData> | null
  cloudLayers: ForecastDataChannel<CloudLayersTimeSliceData> | null
  precipTypeOverlay: ForecastDataChannel<PrecipTypeOverlayTimeSliceData> | null
  pressureContours: ForecastDataChannel<PressureContourTimeSliceData> | null
  particles: ForecastDataChannel<ParticleTimeSliceData> | null
}

type CreateForecastDataPlanArgs = {
  target: ForecastDataTarget
  artifacts: ArtifactLoader
  pressureContoursEnabled?: boolean
}

export function createForecastDataPlan(args: CreateForecastDataPlanArgs): ForecastDataPlan {
  const isCloudLayersLayer = args.target.selectedLayer.source.kind === 'cloud-layers'
  const field = isCloudLayersLayer
    ? null
    : createFieldChannel({
      artifacts: args.artifacts,
      activeRun: args.target.activeRun,
      layer: args.target.selectedLayer,
    })
  const cloudLayers = isCloudLayersLayer
    ? createCloudLayersChannel({
      artifacts: args.artifacts,
      activeRun: args.target.activeRun,
      layer: args.target.selectedLayer,
    })
    : null
  const precipTypeOverlay = createPrecipTypeOverlayChannel({
    artifacts: args.artifacts,
    activeRun: args.target.activeRun,
    layer: args.target.selectedLayer,
  })
  const pressureContours = args.pressureContoursEnabled === false
    ? null
    : createPressureContourChannel({
      artifacts: args.artifacts,
      activeRun: args.target.activeRun,
    })
  const particles = args.target.selectedParticleLayer == null
    ? null
    : createParticleChannel({
      artifacts: args.artifacts,
      activeRun: args.target.activeRun,
      particleLayer: args.target.selectedParticleLayer,
    })

  return {
    activeRun: args.target.activeRun,
    selectedValidTimeMs: args.target.selectedValidTimeMs,
    lowerHourToken: args.target.lowerHourToken,
    upperHourToken: args.target.upperHourToken,
    mix: args.target.mix,
    field,
    cloudLayers,
    precipTypeOverlay,
    pressureContours,
    particles,
  }
}
