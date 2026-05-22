import { isAbortError } from '../abort'
import type { ForecastDataPlan } from './plan'
import type {
  FieldInterpolationWindowData,
  CloudLayersInterpolationWindowData,
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
  const [field, cloudLayers, precipTypeOverlay, pressureContours, particles] = await Promise.all([
    plan.field == null ? Promise.resolve(null) : loadInterpolationWindow<FieldInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.field ?? null,
      loadTimeSlice: plan.field.load,
    }),
    plan.cloudLayers == null ? Promise.resolve(null) : loadInterpolationWindow<CloudLayersInterpolationWindowData['lower']>({
      selection: plan,
      previousWindow: args.previousWindows?.cloudLayers ?? null,
      loadTimeSlice: plan.cloudLayers.load,
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

  return {
    field,
    cloudLayers,
    probeField: field ?? cloudLayersProbeFieldWindow(cloudLayers),
    precipTypeOverlay,
    pressureContours,
    particles,
  }
}

function cloudLayersProbeFieldWindow(
  window: CloudLayersInterpolationWindowData | null
): FieldInterpolationWindowData | null {
  if (window == null) return null
  return {
    selectedValidTimeMs: window.selectedValidTimeMs,
    lowerHourToken: window.lowerHourToken,
    upperHourToken: window.upperHourToken,
    mix: window.mix,
    lower: window.lower.coverage,
    upper: window.upper.coverage,
  }
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
