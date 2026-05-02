import type { LoadedFrameWindow } from '../window'
import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../../manifest'

export type CloudLayerFrameValues = {
  low: Float32Array
  medium: Float32Array
  high: Float32Array
}

export type ScalarFrameData = {
  hourToken: string
  variableId: string
  grid: ScalarGridSpec
  encoding: ScalarEncodingSpec
  values: Float32Array
  cloudLayers?: CloudLayerFrameValues
  displayRange: [number, number]
  colortable: LayerColortableStop[]
}

export type ScalarFrameWindowData = LoadedFrameWindow<ScalarFrameData>
