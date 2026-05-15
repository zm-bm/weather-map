import type { ForecastDataPlan } from './plan'
import type {
  FieldInterpolationWindowData,
  ForecastRenderData,
  ParticleInterpolationWindowData,
  PreviousForecastInterpolationWindows,
} from './types'
import { loadInterpolationWindow } from './window'

type LoadForecastDataArgs = {
  plan: ForecastDataPlan
  previousWindows?: PreviousForecastInterpolationWindows
}

export async function loadForecastData(args: LoadForecastDataArgs): Promise<ForecastRenderData> {
  const { plan } = args
  const [field, particles] = await Promise.all([
    loadInterpolationWindow<FieldInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.field ?? null,
      loadTimeSlice: plan.field.load,
    }),
    plan.particles == null ? Promise.resolve(null) : loadInterpolationWindow<ParticleInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.particles ?? null,
      loadTimeSlice: plan.particles.load,
    }),
  ])

  return { field, particles }
}
