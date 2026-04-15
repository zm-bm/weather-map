import type {
  CycleManifest,
  FramePayloadRef,
  ManifestEncodingSpec,
  ScalarEncodingSpec,
  ScalarGridSpec,
  ScalarVariableSpec,
  VectorEncodingSpec,
  VectorVariableSpec,
} from './types'
import {
  VECTOR_COMPONENT_ORDER,
  VECTOR_COMPONENTS,
  VECTOR_DECODE_FORMULA,
  VECTOR_PAYLOAD_FORMAT,
} from '../vector/engine/types'

export type FrameKind = 'scalar' | 'vector'

export type FrameDomainTypeMap = {
  scalar: {
    variableMeta: ScalarVariableSpec
    encoding: ScalarEncodingSpec
  }
  vector: {
    variableMeta: VectorVariableSpec
    encoding: VectorEncodingSpec
  }
}

const DOMAIN_LABELS: Record<FrameKind, { lower: string; capital: string }> = {
  scalar: { lower: 'scalar', capital: 'Scalar' },
  vector: { lower: 'vector', capital: 'Vector' },
}

export type ResolvedFrameSpec<D extends FrameKind> = {
  frameRef: FramePayloadRef
  variableMeta: FrameDomainTypeMap[D]['variableMeta']
  encoding: FrameDomainTypeMap[D]['encoding']
  grid: ScalarGridSpec
}

export function resolveFrameSpec<D extends FrameKind>(
  manifest: CycleManifest,
  hourToken: string,
  variable: string,
  domain: D
): ResolvedFrameSpec<D> {
  const frameRef = resolveFrameRef(manifest, hourToken, variable, domain)
  const variableMeta = resolveVariableMeta(manifest, variable, domain)
  const encoding = resolveEncoding(manifest, variableMeta.encoding_id, variable, domain)
  const grid = resolveGrid(manifest, variableMeta.grid_id, variable, domain)
  return { frameRef, variableMeta, encoding, grid }
}

export function domainLabelLower(domain: FrameKind): string {
  return DOMAIN_LABELS[domain].lower
}

export function domainLabelCapital(domain: FrameKind): string {
  return DOMAIN_LABELS[domain].capital
}

function resolveFrameRef(
  manifest: CycleManifest,
  hourToken: string,
  variable: string,
  domain: FrameKind
): FramePayloadRef {
  return requiredValue(
    manifest.frames[hourToken]?.[variable],
    `No ${domainLabelLower(domain)} frame ref for variable=${variable} hour=${hourToken}`
  )
}

function resolveVariableMeta<D extends FrameKind>(
  manifest: CycleManifest,
  variable: string,
  domain: D
): FrameDomainTypeMap[D]['variableMeta'] {
  const variableMeta = requiredValue(
    manifest.variableMeta[variable],
    `No ${domainLabelLower(domain)} variable metadata for ${variable}`
  )
  if (variableMeta.kind !== domain) {
    throw new Error(`Variable ${variable} is not ${domain} (got ${variableMeta.kind})`)
  }
  return variableMeta as FrameDomainTypeMap[D]['variableMeta']
}

function resolveEncoding<D extends FrameKind>(
  manifest: CycleManifest,
  encodingId: string,
  variable: string,
  domain: D
): FrameDomainTypeMap[D]['encoding'] {
  const encoding = requiredValue(
    manifest.encodings[encodingId],
    `No ${domainLabelLower(domain)} encoding ${encodingId} for ${variable}`
  )

  if (domain === 'scalar') {
    return resolveScalarEncoding(variable, encoding) as FrameDomainTypeMap[D]['encoding']
  }
  return resolveVectorEncoding(variable, encoding) as FrameDomainTypeMap[D]['encoding']
}

function resolveGrid(
  manifest: CycleManifest,
  gridId: string,
  variable: string,
  domain: FrameKind
): ScalarGridSpec {
  return requiredValue(manifest.grids[gridId], `No ${domainLabelLower(domain)} grid ${gridId} for ${variable}`)
}

function resolveScalarEncoding(variable: string, encoding: ManifestEncodingSpec): ScalarEncodingSpec {
  if (encoding.format !== 'scalar-i16-linear-v1') {
    throw new Error(`Unsupported scalar format for ${variable}: ${encoding.format}`)
  }
  if (!('nodata' in encoding)) {
    throw new Error(`Scalar encoding for ${variable} is missing nodata`)
  }
  return encoding
}

function resolveVectorEncoding(variable: string, encoding: ManifestEncodingSpec): VectorEncodingSpec {
  if (encoding.format !== VECTOR_PAYLOAD_FORMAT) {
    throw new Error(`Unsupported vector format for ${variable}: ${encoding.format}`)
  }
  if (!('components' in encoding) || !('component_count' in encoding) || !('component_order' in encoding)) {
    throw new Error(`Vector encoding for ${variable} is missing component metadata`)
  }
  assertVectorEncoding(variable, encoding)
  return encoding
}

function assertVectorEncoding(variable: string, value: VectorEncodingSpec) {
  if (value.dtype !== 'int8') {
    throw new Error(`Unsupported vector dtype for ${variable}: ${value.dtype}`)
  }
  if (value.byte_order !== 'none') {
    throw new Error(`Unsupported vector byte order for ${variable}: ${value.byte_order}`)
  }
  if (value.component_order !== VECTOR_COMPONENT_ORDER) {
    throw new Error(`Unsupported vector component order for ${variable}: ${value.component_order}`)
  }
  if (value.component_count !== 2) {
    throw new Error(`Unsupported vector component count for ${variable}: ${value.component_count}`)
  }
  if (
    !Array.isArray(value.components) ||
    value.components.length !== 2 ||
    value.components[0] !== VECTOR_COMPONENTS[0] ||
    value.components[1] !== VECTOR_COMPONENTS[1]
  ) {
    throw new Error(`Unsupported vector components for ${variable}: ${JSON.stringify(value.components)}`)
  }
  if (value.decode_formula !== VECTOR_DECODE_FORMULA) {
    throw new Error(`Unsupported vector decode formula for ${variable}: ${value.decode_formula}`)
  }
  if (value.scale !== 0.5 || value.offset !== 0) {
    throw new Error(`Unsupported vector decode params for ${variable}: scale=${value.scale} offset=${value.offset}`)
  }
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}
