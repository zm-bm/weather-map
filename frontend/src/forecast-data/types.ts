import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../forecast-manifest'
import type {
  VectorArtifactData,
} from '../forecast-artifacts'
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
  colortable: LayerColortableStop[]
}

export type ParticleTimeSliceData = VectorArtifactData

export type ForecastDataChannel<T = FieldTimeSliceData | ParticleTimeSliceData> = {
  key: string
  load: (hourToken: string) => Promise<T>
}

export type FieldInterpolationWindowData = LoadedInterpolationWindow<FieldTimeSliceData>
export type ParticleInterpolationWindowData = LoadedInterpolationWindow<ParticleTimeSliceData>

export type ForecastRenderData = {
  field: FieldInterpolationWindowData
  particles: ParticleInterpolationWindowData | null
}

export type PreviousForecastInterpolationWindows = {
  field?: FieldInterpolationWindowData | null
  particles?: ParticleInterpolationWindowData | null
}
