import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../manifest'
import type { VectorArtifactData } from '../forecast-artifacts'
import type { LoadedFrameWindow } from './window'

export type DerivedFieldFrameEncodingSpec = {
  id: string
  format: 'derived-float32-v1'
  dtype: 'float32'
  byteOrder: 'none'
  nodata: number
}

export type FieldFrameEncodingSpec = ScalarEncodingSpec | DerivedFieldFrameEncodingSpec

export type FieldFrameData = {
  hourToken: string
  layerId: string
  paletteId: string
  grid: ScalarGridSpec
  encoding: FieldFrameEncodingSpec
  values: Float32Array
  displayRange: [number, number]
  colortable: LayerColortableStop[]
}

export type ParticleFrameData = VectorArtifactData

export type ForecastFrameChannel<T = FieldFrameData | ParticleFrameData> = {
  key: string
  load: (hourToken: string) => Promise<T>
}

export type FieldFrameWindowData = LoadedFrameWindow<FieldFrameData>
export type ParticleFrameWindowData = LoadedFrameWindow<ParticleFrameData>

export type ForecastFrameBundle = {
  field: FieldFrameWindowData
  particles: ParticleFrameWindowData | null
}

export type PreviousForecastFrameWindows = {
  field?: FieldFrameWindowData | null
  particles?: ParticleFrameWindowData | null
}
