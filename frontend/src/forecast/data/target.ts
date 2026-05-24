import type { ActiveForecastRun } from '@/forecast/manifest'
import type { ForecastTimeSliceSelection } from '@/forecast/time'

export type PrecipTypeSource = {
  id: string
  artifactId: string
  optional: boolean
}

type LayerDisplay = {
  layerId: string
  paletteId: string
  displayRange: [number, number]
  precipType: PrecipTypeSource | null
}

export type ScalarFieldSource = {
  kind: 'scalar'
  artifactId: string
}

export type DerivedFieldSource = {
  kind: 'derived'
  artifactId: string
  recipe: 'wind-speed'
}

export type FieldSource =
  | ScalarFieldSource
  | DerivedFieldSource

export type FieldLayerSource = LayerDisplay & {
  kind: 'field'
  fieldSource: FieldSource
}

export type CloudLayerSource = LayerDisplay & {
  kind: 'cloudLayers'
  artifactId: string
}

export type LayerSource =
  | FieldLayerSource
  | CloudLayerSource

export type WindVectorSource = {
  id: string
  artifactId: string
}

export type ForecastDataTarget = ForecastTimeSliceSelection & {
  activeRun: ActiveForecastRun
  layerSource: LayerSource
  windVectorSource: WindVectorSource | null
  minuteOffset: number
}
