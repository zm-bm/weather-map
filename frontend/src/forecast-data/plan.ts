import type { ArtifactLoader } from '../forecast-artifacts'
import type { ActiveForecastRun } from '../forecast-manifest'
import { createFieldChannel } from './field'
import { createParticleChannel } from './particles'
import type { ForecastDataTarget } from './target'
import type {
  FieldTimeSliceData,
  ForecastDataChannel,
  ParticleTimeSliceData,
} from './types'

export type ForecastDataPlan = {
  activeRun: ActiveForecastRun
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
    activeRun: args.target.activeRun,
    layer: args.target.selectedLayer,
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
    particles,
  }
}
