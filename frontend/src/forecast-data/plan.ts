import type { ArtifactLoader } from '../forecast-artifacts'
import type { CycleManifest } from '../manifest'
import { createFieldChannel } from './field'
import { createParticleChannel } from './particles'
import type { ForecastDataTarget } from './target'
import type {
  FieldTimeSliceData,
  ForecastDataChannel,
  ParticleTimeSliceData,
} from './types'

export type ForecastDataPlan = {
  manifest: CycleManifest
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  field: ForecastDataChannel<FieldTimeSliceData>
  particles: ForecastDataChannel<ParticleTimeSliceData> | null
}

type CreateForecastDataPlanArgs = {
  target: ForecastDataTarget
  artifacts: ArtifactLoader
}

export function createForecastDataPlan(args: CreateForecastDataPlanArgs): ForecastDataPlan {
  const field = createFieldChannel({
    artifacts: args.artifacts,
    manifest: args.target.manifest,
    layer: args.target.selectedLayer,
  })
  const particles = args.target.selectedParticleLayer == null
    ? null
    : createParticleChannel({
      artifacts: args.artifacts,
      manifest: args.target.manifest,
      particleLayer: args.target.selectedParticleLayer,
    })

  return {
    manifest: args.target.manifest,
    selectedValidTimeMs: args.target.selectedValidTimeMs,
    lowerHourToken: args.target.lowerHourToken,
    upperHourToken: args.target.upperHourToken,
    mix: args.target.mix,
    field,
    particles,
  }
}
