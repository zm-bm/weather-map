import type { ArtifactLoader } from '../forecast-artifacts'
import type { CycleManifest } from '../manifest'
import { createFieldChannel } from './field'
import { createParticleChannel } from './particles'
import type { ForecastFrameTarget } from './target'
import type {
  FieldFrameData,
  ForecastFrameChannel,
  ParticleFrameData,
} from './types'

export type ForecastFramePlan = {
  manifest: CycleManifest
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  field: ForecastFrameChannel<FieldFrameData>
  particles: ForecastFrameChannel<ParticleFrameData> | null
}

type CreateForecastFramePlanArgs = {
  target: ForecastFrameTarget
  artifacts: ArtifactLoader
}

export function createForecastFramePlan(args: CreateForecastFramePlanArgs): ForecastFramePlan {
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
