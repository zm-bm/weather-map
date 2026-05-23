import type { ArtifactLoader } from '../forecast-artifacts'
import type { ActiveForecastRun } from '../forecast-manifest'
import {
  createForecastDataLoads,
  createForecastDataRequestKey,
  DEFAULT_FORECAST_DATA_OPTIONS,
  type ForecastDataOptions,
  type ForecastDataLoad,
} from '../forecast-data-loaders'
import type { ForecastDataTarget } from '../forecast-data-targets'

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
  artifacts: ArtifactLoader
  retryToken: number
  options?: Partial<ForecastDataOptions>
}

export function createForecastDataRequest(args: CreateForecastDataRequestArgs): ForecastDataRequest {
  const loads = createForecastDataLoads({
    target: args.target,
    artifacts: args.artifacts,
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
