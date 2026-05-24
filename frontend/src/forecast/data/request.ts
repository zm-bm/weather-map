import { createArtifactLoader } from '@/forecast/artifacts'
import type { WeatherMapConfig } from '@/core/config'
import {
  forecastRunScopeKey,
  normalizeForecastHourToken,
  type ActiveForecastRun,
} from '@/forecast/manifest'
import {
  createForecastDataLoads,
} from './loads'
import type { ForecastDataLoad } from './loadDefinition'
import { DEFAULT_FORECAST_DATA_OPTIONS } from './options'
import type { ForecastDataTarget } from './target'
import type { ForecastDataOptions } from './types'

const NO_DATA_KEY = 'data:none'

export type ForecastDataRequest = {
  activeRun: ActiveForecastRun
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  requestKey: string
  loads: readonly ForecastDataLoad[]
}

type CreateForecastDataRequestArgs = {
  target: ForecastDataTarget
  config: WeatherMapConfig
  signal: AbortSignal
  retryToken: number
  options?: Partial<ForecastDataOptions>
}

export function createForecastDataRequest(args: CreateForecastDataRequestArgs): ForecastDataRequest {
  const artifacts = createArtifactLoader({
    config: args.config,
    activeRun: args.target.activeRun,
    signal: args.signal,
  })
  const loads = createForecastDataLoads({
    target: args.target,
    artifacts,
    options: {
      ...DEFAULT_FORECAST_DATA_OPTIONS,
      ...args.options,
    },
  })

  return {
    activeRun: args.target.activeRun,
    selectedValidTimeMs: args.target.selectedValidTimeMs,
    lowerHourToken: args.target.lowerHourToken,
    upperHourToken: args.target.upperHourToken,
    mix: args.target.mix,
    requestKey: createForecastDataRequestKey({
      activeRun: args.target.activeRun,
      dataKeys: loads.map((load) => load.key),
      lowerHourToken: args.target.lowerHourToken,
      upperHourToken: args.target.upperHourToken,
      minuteOffset: args.target.minuteOffset,
      retryToken: args.retryToken,
    }),
    loads,
  }
}

function createForecastDataRequestKey(args: {
  activeRun: ActiveForecastRun
  dataKeys: readonly string[]
  lowerHourToken: string
  upperHourToken: string
  minuteOffset: number
  retryToken: number
}): string {
  const dataKey = args.dataKeys.length === 0
    ? scopeForecastDataKey(args.activeRun, NO_DATA_KEY)
    : args.dataKeys.join('|')
  return [
    dataKey,
    normalizeForecastHourToken(args.lowerHourToken),
    normalizeForecastHourToken(args.upperHourToken),
    args.minuteOffset,
    args.retryToken,
  ].join(':')
}

function scopeForecastDataKey(
  activeRun: ActiveForecastRun,
  value: string
): string {
  return `${forecastRunScopeKey(activeRun)}:${value}`
}
