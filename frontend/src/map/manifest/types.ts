export type LayerColortableStop = [number, number, number, number] | [number, number, number]

export const MANIFEST_VERSION = 4
export const MANIFEST_CONTRACT = 'forecast-binary-v2'

type Brand<T, B extends string> = T & { readonly __brand: B }

export type NonEmptyArray<T> = [T, ...T[]]
export type ScalarVariableId = Brand<string, 'ScalarVariableId'>
export type VectorVariableId = Brand<string, 'VectorVariableId'>

export function asScalarVariableId(value: string): ScalarVariableId {
  return value as ScalarVariableId
}

export function asVectorVariableId(value: string): VectorVariableId {
  return value as VectorVariableId
}

export type LatestManifest = {
  cycle: string
  generated_at: string
  revision: string
}

export type ScalarGridSpec = {
  crs: string
  nx: number
  ny: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  origin: 'cell_center'
  layout: 'row_major'
  x_wrap: 'repeat' | 'none'
  y_mode: 'clamp'
}

export type ScalarEncodingSpec = {
  format: 'scalar-i16-linear-v1'
  dtype: 'int16'
  byte_order: 'little' | 'big'
  nodata: number
  scale: number
  offset: number
  decode_formula: string
}

export type VectorEncodingSpec = {
  format: 'uv-i8-q0p5-v1'
  dtype: 'int8'
  byte_order: 'none'
  scale: number
  offset: number
  decode_formula: string
  components: ['u', 'v']
  component_count: 2
  component_order: 'u_then_v'
}

export type ManifestEncodingSpec = ScalarEncodingSpec | VectorEncodingSpec

export type ScalarVariableSpec = {
  kind: 'scalar'
  units: string
  parameter: string
  level: string
  valid_min: number
  valid_max: number
  grid_id: string
  encoding_id: string
}

export type VectorVariableSpec = {
  kind: 'vector'
  units: string
  parameter: string
  level: string
  valid_min: number
  valid_max: number
  grid_id: string
  encoding_id: string
}

export type ManifestVariableSpec = ScalarVariableSpec | VectorVariableSpec

export type FramePayloadRef = {
  path: string
  byte_length: number
  sha256: string
}

export type CycleManifest = {
  version: typeof MANIFEST_VERSION
  contract: typeof MANIFEST_CONTRACT
  cycle: string
  generatedAt: string
  revision: string
  forecastHours: string[]
  scalarVariables: NonEmptyArray<ScalarVariableId>
  vectorVariables: NonEmptyArray<VectorVariableId>
  grids: Record<string, ScalarGridSpec>
  encodings: Record<string, ManifestEncodingSpec>
  variableMeta: Record<string, ManifestVariableSpec>
  frames: Record<string, Record<string, FramePayloadRef>>
}
