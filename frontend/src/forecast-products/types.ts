import type {
  ScalarEncodingSpec,
  ScalarGridSpec,
  VectorEncodingSpec,
} from '../forecast-manifest'
import type {
  VectorArtifactData,
} from '../forecast-artifacts'
import type { PaletteStop } from '../forecast-palette'
import type { LoadedInterpolationWindow } from './window'

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

export type ForecastProductChannel<T> = {
  key: string
  load: (hourToken: string) => Promise<T>
}

export type FieldInterpolationWindowData = LoadedInterpolationWindow<FieldTimeSliceData>
export type CloudLayersInterpolationWindowData = LoadedInterpolationWindow<CloudLayersTimeSliceData>
export type PrecipTypeInterpolationWindowData = LoadedInterpolationWindow<PrecipTypeTimeSliceData>
export type PressureInterpolationWindowData = LoadedInterpolationWindow<PressureTimeSliceData>
export type WindVectorInterpolationWindowData = LoadedInterpolationWindow<WindVectorTimeSliceData>

export type ForecastProductId = 'field' | 'cloudLayers' | 'precipType' | 'pressure' | 'windVectors'

export type ForecastProductTimeSlices = {
  field: FieldTimeSliceData
  cloudLayers: CloudLayersTimeSliceData
  precipType: PrecipTypeTimeSliceData
  pressure: PressureTimeSliceData
  windVectors: WindVectorTimeSliceData
}

export type ForecastProductWindows = {
  field?: FieldInterpolationWindowData
  cloudLayers?: CloudLayersInterpolationWindowData
  precipType?: PrecipTypeInterpolationWindowData
  pressure?: PressureInterpolationWindowData
  windVectors?: WindVectorInterpolationWindowData
}

export type ForecastProductFailurePolicy = 'required' | 'optional'

export type ForecastProductLoad<K extends ForecastProductId = ForecastProductId> = {
  id: K
  key: string
  failurePolicy: ForecastProductFailurePolicy
  load: (hourToken: string) => Promise<ForecastProductTimeSlices[K]>
  toProbeField?(
    window: LoadedInterpolationWindow<ForecastProductTimeSlices[K]>
  ): FieldInterpolationWindowData
}

export type LoadedForecastProducts = {
  products: ForecastProductWindows
  probeField: FieldInterpolationWindowData | null
}

export type PreviousForecastProductWindows = ForecastProductWindows
