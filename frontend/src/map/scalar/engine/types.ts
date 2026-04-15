import type {
  LayerColortableStop,
  ScalarEncodingSpec,
  ScalarGridSpec,
} from '../../manifest'

export type ScalarFrameData = {
  variableId: string
  grid: ScalarGridSpec
  encoding: ScalarEncodingSpec
  values: Int16Array
  displayRange: [number, number]
  colortable: LayerColortableStop[]
}
