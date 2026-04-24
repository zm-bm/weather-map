import type { LoadedFrameWindow } from '../../../forecast-frame/window'
import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../../../manifest'

export type ScalarFrameData = {
  hourToken: string
  variableId: string
  grid: ScalarGridSpec
  encoding: ScalarEncodingSpec
  values: Int16Array
  displayRange: [number, number]
  colortable: LayerColortableStop[]
}

export type ScalarFrameWindowData = LoadedFrameWindow<ScalarFrameData>
