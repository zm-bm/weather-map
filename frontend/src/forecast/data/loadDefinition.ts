import type {
  FieldTimeSliceData,
  ForecastDataKind,
  ForecastDataSliceMap,
} from './slices'

export type ForecastDataFailurePolicy = 'required' | 'optional'

export type ForecastDataProbeField<K extends ForecastDataKind = ForecastDataKind> = {
  key: string
  projectTimeSlice(slice: ForecastDataSliceMap[K]): FieldTimeSliceData
}

export type ForecastDataLoad<K extends ForecastDataKind = ForecastDataKind> = {
  id: K
  key: string
  failurePolicy: ForecastDataFailurePolicy
  loadTimeSlice: (hourToken: string) => Promise<ForecastDataSliceMap[K]>
  probeField?: ForecastDataProbeField<K>
}
