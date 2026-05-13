import type {
  CycleManifest,
  FramePayloadRef,
  ManifestProductSpec,
  ScalarProductSpec,
  VectorProductSpec,
} from '../manifest'

export type FrameKind = 'scalar' | 'vector'

type FrameVariableMetaMap = {
  scalar: ScalarProductSpec
  vector: VectorProductSpec
}

export type ResolvedFrameSpec<D extends FrameKind> = {
  frameRef: FramePayloadRef
  variable: FrameVariableMetaMap[D]
}

export function resolveFrameSpec<D extends FrameKind>(
  manifest: CycleManifest,
  hourToken: string,
  variable: string,
  domain: D
): ResolvedFrameSpec<D> {
  const resolvedVariable = resolveVariable(manifest, variable, domain)
  const frameRef = resolveFrameRef(resolvedVariable, hourToken, variable, domain)
  return { frameRef, variable: resolvedVariable }
}

function resolveFrameRef(
  resolvedVariable: ManifestProductSpec,
  hourToken: string,
  variable: string,
  domain: FrameKind
): FramePayloadRef {
  return requiredValue(
    resolvedVariable.frames[hourToken],
    `No ${domain} frame ref for variable=${variable} hour=${hourToken}`
  )
}

function resolveVariable<D extends FrameKind>(
  manifest: CycleManifest,
  variable: string,
  domain: D
): FrameVariableMetaMap[D] {
  const resolvedVariable = requiredValue(
    manifest.products[variable],
    `No ${domain} variable metadata for ${variable}`
  )
  if (resolvedVariable.kind !== domain) {
    throw new Error(`Variable ${variable} is not ${domain} (got ${resolvedVariable.kind})`)
  }
  return resolvedVariable as FrameVariableMetaMap[D]
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}
