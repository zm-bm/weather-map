import type { LoadedFrameWindow } from '../window'
import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../../manifest'

export type ScalarFrameData = {
  hourToken: string
  variableId: string
  paletteId: string
  grid: ScalarGridSpec
  encoding: ScalarEncodingSpec
  values: Float32Array
  displayRange: [number, number]
  colortable: LayerColortableStop[]
}

export type ScalarFrameWindowData = LoadedFrameWindow<ScalarFrameData>
