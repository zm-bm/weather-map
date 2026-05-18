import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../forecast-manifest'
import type {
  ScalarArtifactData,
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

export type FieldTimeSliceData = {
  hourToken: string
  layerId: string
  paletteId: string
  grid: ScalarGridSpec
  encoding: FieldEncodingSpec
  values: Float32Array
  displayRange: [number, number]
  colortable: LayerColortableStop[]
  overlays: readonly FieldOverlayData[]
  classifiedColoring?: FieldClassifiedColoring
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
