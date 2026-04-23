import type {
  CycleManifest,
  FramePayloadRef,
  ManifestEncodingSpec,
  ScalarGridSpec,
  ScalarVariableSpec,
  VectorVariableSpec,
} from '../manifest/types'

export type FrameKind = 'scalar' | 'vector'

type FrameVariableMetaMap = {
  scalar: ScalarVariableSpec
  vector: VectorVariableSpec
}

export type ResolvedFrameSpec<D extends FrameKind> = {
  frameRef: FramePayloadRef
  variableMeta: FrameVariableMetaMap[D]
  encoding: ManifestEncodingSpec
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
  const encoding = resolveManifestEncoding(manifest, variableMeta.encoding_id, variable, domain)
  const grid = resolveGrid(manifest, variableMeta.grid_id, variable, domain)
  return { frameRef, variableMeta, encoding, grid }
}

function resolveFrameRef(
  manifest: CycleManifest,
  hourToken: string,
  variable: string,
  domain: FrameKind
): FramePayloadRef {
  return requiredValue(
    manifest.frames[hourToken]?.[variable],
    `No ${domain} frame ref for variable=${variable} hour=${hourToken}`
  )
}

function resolveVariableMeta<D extends FrameKind>(
  manifest: CycleManifest,
  variable: string,
  domain: D
): FrameVariableMetaMap[D] {
  const variableMeta = requiredValue(
    manifest.variableMeta[variable],
    `No ${domain} variable metadata for ${variable}`
  )
  if (variableMeta.kind !== domain) {
    throw new Error(`Variable ${variable} is not ${domain} (got ${variableMeta.kind})`)
  }
  return variableMeta as FrameVariableMetaMap[D]
}

function resolveManifestEncoding(
  manifest: CycleManifest,
  encodingId: string,
  variable: string,
  domain: FrameKind
): ManifestEncodingSpec {
  return requiredValue(
    manifest.encodings[encodingId],
    `No ${domain} encoding ${encodingId} for ${variable}`
  )
}

function resolveGrid(
  manifest: CycleManifest,
  gridId: string,
  variable: string,
  domain: FrameKind
): ScalarGridSpec {
  return requiredValue(
    manifest.grids[gridId],
    `No ${domain} grid ${gridId} for ${variable}`
  )
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}
