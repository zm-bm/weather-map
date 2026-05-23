import type {
  ScalarEncodingSpec,
  ScalarGridSpec,
  VectorEncodingSpec,
} from '../forecast-manifest'
import type {
  VectorArtifactData,
} from '../forecast-artifacts'

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

export type ForecastDataSliceMap = {
  field: FieldTimeSliceData
  cloudLayers: CloudLayersTimeSliceData
  precipType: PrecipTypeTimeSliceData
  pressure: PressureTimeSliceData
  windVectors: WindVectorTimeSliceData
}

export type ForecastDataKind = keyof ForecastDataSliceMap
