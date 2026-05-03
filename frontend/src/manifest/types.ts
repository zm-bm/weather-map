export type LayerColortableStop = [number, number, number, number] | [number, number, number]

export const MANIFEST_SCHEMA = 'weather-map.cycle-manifest'
export const MANIFEST_SCHEMA_VERSION = 2
export const MANIFEST_PAYLOAD_CONTRACT = 'forecast-binary-v2'

type Brand<T, B extends string> = T & { readonly __brand: B }

export type NonEmptyArray<T> = [T, ...T[]]
export type ScalarProductId = Brand<string, 'ScalarProductId'>
export type VectorProductId = Brand<string, 'VectorProductId'>

export function asScalarProductId(value: string): ScalarProductId {
  return value as ScalarProductId
}

export function asVectorProductId(value: string): VectorProductId {
  return value as VectorProductId
}

export type ForecastModelSpec = {
  id: string
  label: string
}

export type ForecastRunSpec = {
  cycle: string
  generatedAt: string
  revision: string
}

export type ForecastTimeSpec = {
  id: string
  leadHours: number
  validAt: string
}

export type ScalarGridSpec = {
  id: string
  crs: string
  nx: number
  ny: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  origin: 'cell_center'
  layout: 'row_major'
  xWrap: 'repeat' | 'none'
  yMode: 'clamp'
}

export type ScalarLinearInt16EncodingSpec = {
  id: string
  format: 'linear-i16-v1'
  dtype: 'int16'
  byteOrder: 'little' | 'big'
  nodata: number
  scale: number
  offset: number
  decodeFormula: string
}

export type ScalarLinearInt8EncodingSpec = {
  id: string
  format: 'linear-i8-v1'
  dtype: 'int8'
  byteOrder: 'none'
  nodata: number
  scale: number
  offset: number
  decodeFormula: string
}

export type ScalarCloudLayerEncodingSpec = {
  id: string
  format: 'linear-i8-v1'
  dtype: 'int8'
  byteOrder: 'none'
  nodata: number
  scale: number
  offset: number
  decodeFormula: string
  components: ['low', 'medium', 'high']
}

export type ScalarTempCPiecewiseEncodingSpec = {
  id: string
  format: 'temp-c-piecewise-i8-v1'
  dtype: 'int8'
  byteOrder: 'none'
  nodata: number
}

export type ScalarEncodingSpec =
  | ScalarLinearInt16EncodingSpec
  | ScalarLinearInt8EncodingSpec
  | ScalarCloudLayerEncodingSpec
  | ScalarTempCPiecewiseEncodingSpec

export type VectorEncodingSpec = {
  id: string
  format: 'linear-i8-v1'
  dtype: 'int8'
  byteOrder: 'none'
  scale: number
  offset: number
  decodeFormula: string
  components: ['u', 'v']
}

export type ManifestEncodingSpec = ScalarEncodingSpec | VectorEncodingSpec

export type ValueRangeSpec = {
  min: number
  max: number
}

export type FramePayloadRef = {
  path: string
  byteLength: number
  sha256: string
}

export type ManifestProductBaseSpec = {
  id: string
  label: string
  units: string
  parameter: string
  level: string
  valueRange: ValueRangeSpec
  grid: ScalarGridSpec
  encoding: ManifestEncodingSpec
  frames: Record<string, FramePayloadRef>
}

export type ScalarProductSpec = ManifestProductBaseSpec & {
  kind: 'scalar'
  encoding: ScalarEncodingSpec
}

export type VectorProductSpec = ManifestProductBaseSpec & {
  kind: 'vector'
  encoding: VectorEncodingSpec
}

export type ManifestProductSpec = ScalarProductSpec | VectorProductSpec

export type ScalarProductGroupSpec = {
  id: string
  kind: 'scalar'
  label: string
  defaultProduct: ScalarProductId
  products: NonEmptyArray<ScalarProductId>
}

export type CycleManifest = {
  schema: typeof MANIFEST_SCHEMA
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  payloadContract: typeof MANIFEST_PAYLOAD_CONTRACT
  model: ForecastModelSpec
  run: ForecastRunSpec
  times: ForecastTimeSpec[]
  groups: ScalarProductGroupSpec[]
  products: Record<string, ManifestProductSpec>

  scalarProducts: ScalarProductId[]
  vectorProducts: VectorProductId[]
}
