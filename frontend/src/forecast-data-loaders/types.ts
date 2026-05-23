import type {
  ScalarEncodingSpec,
  ScalarGridSpec,
  VectorEncodingSpec,
} from '../forecast-manifest'
import type {
  VectorArtifactData,
} from '../forecast-artifacts'
import type { PaletteStop } from '../forecast-palette'

export type LoadedInterpolationWindow<T> = {
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  lower: T
  upper: T
}

export type DerivedFieldEncodingSpec = {
  id: string
  format: 'derived-float32-v1'
  dtype: 'float32'
  byteOrder: 'none'
  nodata: number
}

export type FieldEncodingSpec = ScalarEncodingSpec | DerivedFieldEncodingSpec

export type FieldTimeSliceData = {
  hourToken: string
  layerId: string
  paletteId: string
  grid: ScalarGridSpec
  encoding: FieldEncodingSpec
  values: Float32Array
  displayRange: [number, number]
  colorStops: PaletteStop[]
}

export type PrecipTypeTimeSliceData = {
  hourToken: string
  artifactId: string
  grid: ScalarGridSpec
  snowFrac: Float32Array
  mixFrac: Float32Array
}

export type PressureTimeSliceData = {
  hourToken: string
  artifactId: string
  grid: ScalarGridSpec
  pressureHpa: Float32Array
}

export type CloudLayersTimeSliceData = {
  hourToken: string
  layerId: string
  artifactId: string
  grid: ScalarGridSpec
  encoding: VectorEncodingSpec
  low: Int8Array
  middle: Int8Array
  high: Int8Array
  coverage: FieldTimeSliceData
}

export type WindVectorTimeSliceData = VectorArtifactData

export type ForecastDataKind = 'field' | 'cloudLayers' | 'precipType' | 'pressure' | 'windVectors'

export type ForecastDataTimeSlices = {
  field: FieldTimeSliceData
  cloudLayers: CloudLayersTimeSliceData
  precipType: PrecipTypeTimeSliceData
  pressure: PressureTimeSliceData
  windVectors: WindVectorTimeSliceData
}

export type ForecastDataFailurePolicy = 'required' | 'optional'

export type ForecastDataLoad<K extends ForecastDataKind = ForecastDataKind> = {
  id: K
  key: string
  failurePolicy: ForecastDataFailurePolicy
  loadTimeSlice: (hourToken: string) => Promise<ForecastDataTimeSlices[K]>
  toProbeField?(
    window: LoadedInterpolationWindow<ForecastDataTimeSlices[K]>
  ): LoadedInterpolationWindow<FieldTimeSliceData>
}
