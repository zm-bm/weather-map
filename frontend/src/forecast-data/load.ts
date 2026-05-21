import { isAbortError } from '../abort'
import type { ForecastDataPlan } from './plan'
import type {
  FieldInterpolationWindowData,
  ForecastRenderData,
  ParticleInterpolationWindowData,
  PrecipTypeOverlayInterpolationWindowData,
  PressureContourInterpolationWindowData,
  PreviousForecastInterpolationWindows,
} from './types'
import { loadInterpolationWindow } from './window'

type LoadForecastDataArgs = {
  plan: ForecastDataPlan
  previousWindows?: PreviousForecastInterpolationWindows
}

export async function loadForecastData(args: LoadForecastDataArgs): Promise<ForecastRenderData> {
  const { plan } = args
  const [field, precipTypeOverlay, pressureContours, particles] = await Promise.all([
    loadInterpolationWindow<FieldInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.field ?? null,
      loadTimeSlice: plan.field.load,
    }),
    loadOptionalPrecipTypeOverlayWindow({
      plan,
      previousWindow: args.previousWindows?.precipTypeOverlay ?? null,
    }),
    loadOptionalPressureContourWindow({
      plan,
      previousWindow: args.previousWindows?.pressureContours ?? null,
    }),
    plan.particles == null ? Promise.resolve(null) : loadInterpolationWindow<ParticleInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.particles ?? null,
      loadTimeSlice: plan.particles.load,
    }),
  ])

  return { field, precipTypeOverlay, pressureContours, particles }
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

async function loadOptionalPressureContourWindow(args: {
  plan: ForecastDataPlan
  previousWindow: PreviousForecastInterpolationWindows['pressureContours']
}): Promise<PressureContourInterpolationWindowData | null> {
  if (args.plan.pressureContours == null) return null

  try {
    return await loadInterpolationWindow<PressureContourInterpolationWindowData['lower']>({
      selection: args.plan,
      previousWindow: args.previousWindow ?? null,
      loadTimeSlice: args.plan.pressureContours.load,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    return null
  }
}
