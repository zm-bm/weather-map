import type {
  CloudLayersTimeSliceData,
  FieldTimeSliceData,
  ForecastDataTimeSlices,
  LoadedInterpolationWindow,
  PrecipTypeTimeSliceData,
  PressureTimeSliceData,
  WindVectorTimeSliceData,
} from '../forecast-data-loaders'

export type FieldInterpolationWindowData = LoadedInterpolationWindow<FieldTimeSliceData>
export type CloudLayersInterpolationWindowData = LoadedInterpolationWindow<CloudLayersTimeSliceData>
export type PrecipTypeInterpolationWindowData = LoadedInterpolationWindow<PrecipTypeTimeSliceData>
export type PressureInterpolationWindowData = LoadedInterpolationWindow<PressureTimeSliceData>
export type WindVectorInterpolationWindowData = LoadedInterpolationWindow<WindVectorTimeSliceData>

export type ForecastDataWindows = {
  field?: FieldInterpolationWindowData
  cloudLayers?: CloudLayersInterpolationWindowData
  precipType?: PrecipTypeInterpolationWindowData
  pressure?: PressureInterpolationWindowData
  windVectors?: WindVectorInterpolationWindowData
}

export type LoadedForecastData = {
  windows: ForecastDataWindows
  probeField: FieldInterpolationWindowData | null
}

export type PreviousForecastDataWindows = ForecastDataWindows

export type ForecastDataWindow<K extends keyof ForecastDataTimeSlices> =
  LoadedInterpolationWindow<ForecastDataTimeSlices[K]>
