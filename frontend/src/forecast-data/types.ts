import type {
  ForecastDataKind,
  ForecastDataSliceMap,
} from './slices'
import type { LoadedInterpolationWindow } from './interpolationWindow'

export type {
  CloudLayersTimeSliceData,
  FieldEncodingSpec,
  FieldTimeSliceData,
  ForecastDataKind,
  ForecastDataSliceMap,
  PrecipTypeTimeSliceData,
  PressureTimeSliceData,
  WindVectorTimeSliceData,
} from './slices'

export type ForecastDataOptions = {
  pressure: boolean
  windVectors: boolean
}

export type ForecastDataWindow<K extends ForecastDataKind> =
  LoadedInterpolationWindow<ForecastDataSliceMap[K]>

export type FieldInterpolationWindowData = ForecastDataWindow<'field'>
export type CloudLayersInterpolationWindowData = ForecastDataWindow<'cloudLayers'>
export type PrecipTypeInterpolationWindowData = ForecastDataWindow<'precipType'>
export type PressureInterpolationWindowData = ForecastDataWindow<'pressure'>
export type WindVectorInterpolationWindowData = ForecastDataWindow<'windVectors'>

export type ForecastDataWindows = Partial<{
  [K in ForecastDataKind]: ForecastDataWindow<K>
}>

export type LoadedForecastData = {
  windows: ForecastDataWindows
  probeField: FieldInterpolationWindowData | null
}
