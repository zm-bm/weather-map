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

export type ScalarInt16EncodingSpec = {
  format: 'scalar-i16-linear-v1'
  dtype: 'int16'
  byte_order: 'little' | 'big'
  nodata: number
  scale: number
  offset: number
  decode_formula: string
}

export type ScalarInt8EncodingSpec = {
  format: 'scalar-i8-linear-v1'
  dtype: 'int8'
  byte_order: 'none'
  nodata: number
  scale: number
  offset: number
  decode_formula: string
}

export type ScalarInt8LinearComponentsEncodingSpec = {
  format: 'scalar-i8-linear-components-v1'
  dtype: 'int8'
  byte_order: 'none'
  nodata: number
  scale: number
  offset: number
  decode_formula: string
  components: ['low', 'medium', 'high']
  component_count: 3
  component_order: 'low_medium_high'
}

export type ScalarTempCPiecewiseEncodingSpec = {
  format: 'scalar-i8-temp-c-piecewise-v1'
  dtype: 'int8'
  byte_order: 'none'
  nodata: number
}

export type ScalarEncodingSpec =
  | ScalarInt16EncodingSpec
  | ScalarInt8EncodingSpec
  | ScalarInt8LinearComponentsEncodingSpec
  | ScalarTempCPiecewiseEncodingSpec

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

export type ScalarVariableGroupSpec = {
  id: string
  label: string
  defaultVariable: ScalarVariableId
  variables: NonEmptyArray<ScalarVariableId>
}

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
  scalarVariableGroups: NonEmptyArray<ScalarVariableGroupSpec>
  vectorVariables: NonEmptyArray<VectorVariableId>
  grids: Record<string, ScalarGridSpec>
  encodings: Record<string, ManifestEncodingSpec>
  variableMeta: Record<string, ManifestVariableSpec>
  frames: Record<string, Record<string, FramePayloadRef>>
}
