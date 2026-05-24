import type {
  ScalarEncodingSpec,
  ScalarGridSpec,
  VectorEncodingSpec,
} from '@/forecast/manifest'

export type ArtifactKind = 'scalar' | 'vector'

export type ScalarArtifactData = {
  hourToken: string
  artifactId: string
  grid: ScalarGridSpec
  encoding: ScalarEncodingSpec
  values: Float32Array
}

export const VECTOR_PAYLOAD_FORMAT = 'linear-i8-v1'
export const VECTOR_DECODE_FORMULA = 'value = stored * scale + offset'
export const WIND_VECTOR_COMPONENTS = ['u', 'v'] as const

export type VectorArtifactData = {
  artifactId: string
  hourToken: string
  scale: number
  offset: number
  u: Int8Array
  v: Int8Array
  grid: ScalarGridSpec
}

export type VectorComponentArtifactData = {
  artifactId: string
  hourToken: string
  grid: ScalarGridSpec
  encoding: VectorEncodingSpec
  componentIds: readonly string[]
  components: Record<string, Float32Array>
}

export type RawVectorComponentArtifactData = {
  artifactId: string
  hourToken: string
  grid: ScalarGridSpec
  encoding: VectorEncodingSpec
  componentIds: readonly string[]
  components: Record<string, Int8Array>
}
