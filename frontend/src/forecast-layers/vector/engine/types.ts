export const VECTOR_PAYLOAD_FORMAT = 'uv-i8-q0p5-v1'
export const VECTOR_COMPONENT_ORDER = 'u_then_v'
export const VECTOR_DECODE_FORMULA = 'value = stored * scale + offset'
export const VECTOR_COMPONENTS = ['u', 'v'] as const

export type VectorFrameMetadata = {
  kind: 'vector'
  variableId: string
  hourToken: string
  units: string
  parameter: string
  level: string
  valid_min: number
  valid_max: number
  format: typeof VECTOR_PAYLOAD_FORMAT
  dtype: 'int8'
  byte_order: 'none'
  scale: number
  offset: number
  decode_formula: string
  components: ['u', 'v']
  component_count: 2
  component_order: typeof VECTOR_COMPONENT_ORDER
  grid_id: string
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
