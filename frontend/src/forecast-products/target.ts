import {
  type LayerSpec,
} from '../forecast-catalog'
import {
  type ForecastTimeSliceSelection,
  type ForecastInterpolationWindow,
  interpolationWindowMinuteOffset,
} from '../forecast-time'
import type { ActiveForecastRun } from '../forecast-manifest'
import { normalizeForecastHourToken } from '../forecast-manifest'

export type WindVectorSource = {
  id: string
  artifactId: string
}

export type ForecastProductTarget = ForecastTimeSliceSelection & {
  activeRun: ActiveForecastRun
  selectedLayer: LayerSpec
  windVectorSource: WindVectorSource | null
  minuteOffset: number
}

type CreateForecastProductTargetArgs = {
  activeRun: ActiveForecastRun
  selectedLayer: LayerSpec
  windVectorSource: WindVectorSource | null
  interpolationWindow: ForecastInterpolationWindow
}

export function createForecastProductTarget(args: CreateForecastProductTargetArgs): ForecastProductTarget {
  const { activeRun, interpolationWindow } = args
  const lowerHourToken = normalizeForecastHourToken(interpolationWindow.lowerHourToken)
  const upperHourToken = normalizeForecastHourToken(interpolationWindow.upperHourToken)

  return {
    activeRun,
    selectedLayer: args.selectedLayer,
    windVectorSource: args.windVectorSource,
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerHourToken,
    upperHourToken,
    mix: interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(interpolationWindow),
  }
}
