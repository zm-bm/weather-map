import { isAbortError } from '../abort'
import type { ForecastDataPlan } from './plan'
import type {
  FieldInterpolationWindowData,
  ForecastRenderData,
  ParticleInterpolationWindowData,
  PrecipTypeOverlayInterpolationWindowData,
  PreviousForecastInterpolationWindows,
} from './types'
import { loadInterpolationWindow } from './window'

type LoadForecastDataArgs = {
  plan: ForecastDataPlan
  previousWindows?: PreviousForecastInterpolationWindows
}

export async function loadForecastData(args: LoadForecastDataArgs): Promise<ForecastRenderData> {
  const { plan } = args
  const [field, precipTypeOverlay, particles] = await Promise.all([
    loadInterpolationWindow<FieldInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.field ?? null,
      loadTimeSlice: plan.field.load,
    }),
    loadOptionalPrecipTypeOverlayWindow({
      plan,
      previousWindow: args.previousWindows?.precipTypeOverlay ?? null,
    }),
    plan.particles == null ? Promise.resolve(null) : loadInterpolationWindow<ParticleInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.particles ?? null,
      loadTimeSlice: plan.particles.load,
    }),
  ])

  return { field, precipTypeOverlay, particles }
}

async function loadOptionalPrecipTypeOverlayWindow(args: {
  plan: ForecastDataPlan
  previousWindow: PreviousForecastInterpolationWindows['precipTypeOverlay']
}): Promise<PrecipTypeOverlayInterpolationWindowData | null> {
  if (args.plan.precipTypeOverlay == null) return null

  try {
    return await loadInterpolationWindow<PrecipTypeOverlayInterpolationWindowData['lower']>({
      selection: args.plan,
      previousWindow: args.previousWindow ?? null,
      loadTimeSlice: args.plan.precipTypeOverlay.load,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    return null
  }
}
