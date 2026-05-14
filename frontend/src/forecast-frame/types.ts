import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../manifest'
import type {
  ScalarArtifactData,
  VectorArtifactData,
} from '../forecast-artifacts'
import type { LoadedFrameWindow } from './window'

export type DerivedFieldFrameEncodingSpec = {
  id: string
  format: 'derived-float32-v1'
  dtype: 'float32'
  byteOrder: 'none'
  nodata: number
}

export type FieldFrameEncodingSpec = ScalarEncodingSpec | DerivedFieldFrameEncodingSpec

export type FieldOverlayData = Pick<
  ScalarArtifactData,
  'artifactId' | 'hourToken' | 'grid' | 'encoding' | 'values'
> & {
  id: string
}

export type FieldClassifiedColoringClass = {
  values: readonly number[]
  colortable: LayerColortableStop[]
}

export type FieldClassifiedColoring = {
  classifierOverlayId: string
  classes: readonly FieldClassifiedColoringClass[]
}

export type FieldFrameData = {
  hourToken: string
  layerId: string
  paletteId: string
  grid: ScalarGridSpec
  encoding: FieldFrameEncodingSpec
  values: Float32Array
  displayRange: [number, number]
  colortable: LayerColortableStop[]
  overlays: readonly FieldOverlayData[]
  classifiedColoring?: FieldClassifiedColoring
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
