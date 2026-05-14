import type { ForecastFramePlan } from './plan'
import type {
  FieldFrameWindowData,
  ForecastFrameBundle,
  ParticleFrameWindowData,
  PreviousForecastFrameWindows,
} from './types'
import { loadFrameWindow } from './window'

type LoadForecastFramesArgs = {
  plan: ForecastFramePlan
  previousWindows?: PreviousForecastFrameWindows
}

export async function loadForecastFrames(args: LoadForecastFramesArgs): Promise<ForecastFrameBundle> {
  const { plan } = args
  const [field, particles] = await Promise.all([
    loadFrameWindow<FieldFrameWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.field ?? null,
      loadFrame: plan.field.load,
    }),
    plan.particles == null ? Promise.resolve(null) : loadFrameWindow<ParticleFrameWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.particles ?? null,
      loadFrame: plan.particles.load,
    }),
  ])

  return { field, particles }
}
