import {
  forecastRunScopeKey,
  type ActiveForecastRun,
} from '../forecast-manifest'
import { normalizeForecastHourToken } from '../forecast-manifest'
import type {
  ForecastCloudLayerSource,
  ForecastFieldDataSource,
  ForecastFieldLayerSource,
  ForecastPrecipTypeDataSource,
  ForecastWindVectorDataSource,
} from '../forecast-data-targets'

export const NO_DATA_KEY = 'data:none'

export function createFieldDataKey(
  activeRun: ActiveForecastRun,
  source: ForecastFieldLayerSource
): string {
  return scopeForecastDataKey(activeRun, createFieldRequestKey(source))
}

export function createWindVectorDataKey(
  activeRun: ActiveForecastRun,
  source: ForecastWindVectorDataSource
): string {
  return scopeForecastDataKey(
    activeRun,
    createWindVectorRequestKey(source)
  )
}

export function createCloudLayersDataKey(
  activeRun: ActiveForecastRun,
  source: ForecastCloudLayerSource
): string {
  return scopeForecastDataKey(activeRun, createCloudLayersRequestKey(source))
}

export function createPrecipTypeDataKey(
  activeRun: ActiveForecastRun,
  source: ForecastPrecipTypeDataSource
): string {
  return scopeForecastDataKey(
    activeRun,
    createPrecipTypeRequestKey(source)
  )
}

export function createPressureDataKey(
  activeRun: ActiveForecastRun,
  artifactId: string
): string {
  return scopeForecastDataKey(
    activeRun,
    `pressure:${artifactId}`
  )
}

export function createForecastDataRequestKey(args: {
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

export function createFieldTimeSliceCacheKey(args: {
  activeRun: ActiveForecastRun
  source: ForecastFieldLayerSource
  hourToken: string
}): string {
  return scopeForecastDataKey(
    args.activeRun,
    `${createFieldRequestKey(args.source)}:${normalizeForecastHourToken(args.hourToken)}`
  )
}

export function createCloudLayersTimeSliceCacheKey(args: {
  activeRun: ActiveForecastRun
  source: ForecastCloudLayerSource
  hourToken: string
}): string {
  return scopeForecastDataKey(
    args.activeRun,
    `${createCloudLayersRequestKey(args.source)}:${normalizeForecastHourToken(args.hourToken)}`
  )
}

function scopeForecastDataKey(
  activeRun: ActiveForecastRun,
  value: string
): string {
  return `${forecastRunScopeKey(activeRun)}:${value}`
}

function createFieldRequestKey(source: ForecastFieldLayerSource): string {
  return `${source.layerId}:${fieldDataSourceKey(source.dataSource)}`
}

function createCloudLayersRequestKey(source: ForecastCloudLayerSource): string {
  return `${source.layerId}:cloud-layers:${source.artifactId}`
}

function fieldDataSourceKey(source: ForecastFieldDataSource): string {
  if (source.kind === 'scalar') return `artifact:${source.artifactId}`
  return `derived:${source.recipe}:${source.artifactId}`
}

function createWindVectorRequestKey(source: ForecastWindVectorDataSource): string {
  return `wind-vectors:${source.id}:${source.artifactId}`
}

function createPrecipTypeRequestKey(source: ForecastPrecipTypeDataSource): string {
  return `precip-type:${source.id}:${source.artifactId}`
}
