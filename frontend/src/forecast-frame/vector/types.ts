import type { LoadedFrameWindow } from '../window'

export const VECTOR_PAYLOAD_FORMAT = 'linear-i8-v1'
export const VECTOR_DECODE_FORMULA = 'value = stored * scale + offset'
export const VECTOR_COMPONENTS = ['u', 'v'] as const

export type VectorFrameMetadata = {
  kind: 'vector'
  variableId: string
  hourToken: string
  units: string
  parameter: string
  level: string
  format: typeof VECTOR_PAYLOAD_FORMAT
  dtype: 'int8'
  byteOrder: 'none'
  scale: number
  offset: number
  decodeFormula: string
  components: ['u', 'v']
  gridId: string
  nx: number
  ny: number
  lon0: number
  lat0: number
  dx: number
  dy: number
}

export type VectorFrameData = {
  u: Int8Array
  v: Int8Array
  metadata: VectorFrameMetadata
}

export type VectorFrameWindowData = LoadedFrameWindow<VectorFrameData>
