import type { ActiveForecastRun } from '../forecast-manifest'
import type { ForecastTimeSliceSelection } from '../forecast-time'

export type ForecastPrecipTypeDataSource = {
  id: string
  artifactId: string
  optional: boolean
}

type ForecastDataLayerDisplay = {
  layerId: string
  paletteId: string
  displayRange: [number, number]
  precipType: ForecastPrecipTypeDataSource | null
}

export type ForecastScalarFieldDataSource = {
  kind: 'scalar'
  artifactId: string
}

export type ForecastDerivedFieldDataSource = {
  kind: 'derived'
  artifactId: string
  recipe: 'wind-speed'
}

export type ForecastFieldDataSource =
  | ForecastScalarFieldDataSource
  | ForecastDerivedFieldDataSource

export type ForecastFieldLayerSource = ForecastDataLayerDisplay & {
  kind: 'field'
  dataSource: ForecastFieldDataSource
}

export type ForecastCloudLayerSource = ForecastDataLayerDisplay & {
  kind: 'cloudLayers'
  artifactId: string
}

export type ForecastLayerDataSource =
  | ForecastFieldLayerSource
  | ForecastCloudLayerSource

export type ForecastWindVectorDataSource = {
  id: string
  artifactId: string
}

export type ForecastDataTarget = ForecastTimeSliceSelection & {
  activeRun: ActiveForecastRun
  layerDataSource: ForecastLayerDataSource
  windVectorDataSource: ForecastWindVectorDataSource | null
  minuteOffset: number
}
