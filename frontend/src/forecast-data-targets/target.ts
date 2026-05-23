import {
  type ForecastInterpolationWindow,
  interpolationWindowMinuteOffset,
} from '../forecast-time'
import type { ActiveForecastRun } from '../forecast-manifest'
import { normalizeForecastHourToken } from '../forecast-manifest'
import type {
  ForecastDataTarget,
  ForecastLayerDataSource,
  ForecastWindVectorDataSource,
} from './types'

type CreateForecastDataTargetArgs = {
  activeRun: ActiveForecastRun
  layerDataSource: ForecastLayerDataSource
  windVectorDataSource: ForecastWindVectorDataSource | null
  interpolationWindow: ForecastInterpolationWindow
}

export function createForecastDataTarget(args: CreateForecastDataTargetArgs): ForecastDataTarget {
  const { activeRun, interpolationWindow } = args
  const lowerHourToken = normalizeForecastHourToken(interpolationWindow.lowerHourToken)
  const upperHourToken = normalizeForecastHourToken(interpolationWindow.upperHourToken)

  return {
    activeRun,
    layerDataSource: args.layerDataSource,
    windVectorDataSource: args.windVectorDataSource,
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerHourToken,
    upperHourToken,
    mix: interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(interpolationWindow),
  }
}
