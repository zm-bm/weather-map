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

export type PrecipTypeOverlayTimeSliceData = {
  hourToken: string
  artifactId: string
  grid: ScalarGridSpec
  snowFrac: Float32Array
  mixFrac: Float32Array
}

export type PressureContourTimeSliceData = {
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
  textureBytes: Uint8Array
  coverage: FieldTimeSliceData
}

export type ParticleTimeSliceData = VectorArtifactData

export type ForecastDataChannel<T =
  | FieldTimeSliceData
  | CloudLayersTimeSliceData
  | ParticleTimeSliceData
  | PrecipTypeOverlayTimeSliceData
  | PressureContourTimeSliceData
> = {
  key: string
  load: (hourToken: string) => Promise<T>
}

export type FieldInterpolationWindowData = LoadedInterpolationWindow<FieldTimeSliceData>
export type CloudLayersInterpolationWindowData = LoadedInterpolationWindow<CloudLayersTimeSliceData>
export type PrecipTypeOverlayInterpolationWindowData = LoadedInterpolationWindow<PrecipTypeOverlayTimeSliceData>
export type PressureContourInterpolationWindowData = LoadedInterpolationWindow<PressureContourTimeSliceData>
export type ParticleInterpolationWindowData = LoadedInterpolationWindow<ParticleTimeSliceData>

export type ForecastRenderData = {
  field: FieldInterpolationWindowData | null
  cloudLayers: CloudLayersInterpolationWindowData | null
  probeField: FieldInterpolationWindowData | null
  precipTypeOverlay: PrecipTypeOverlayInterpolationWindowData | null
  pressureContours: PressureContourInterpolationWindowData | null
  particles: ParticleInterpolationWindowData | null
}

export type PreviousForecastInterpolationWindows = {
  field?: FieldInterpolationWindowData | null
  cloudLayers?: CloudLayersInterpolationWindowData | null
  precipTypeOverlay?: PrecipTypeOverlayInterpolationWindowData | null
  pressureContours?: PressureContourInterpolationWindowData | null
  particles?: ParticleInterpolationWindowData | null
}
