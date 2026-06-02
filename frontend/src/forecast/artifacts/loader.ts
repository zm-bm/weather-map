import type { ReadonlyNonEmptyArray } from '@/core/types'
import type { WeatherMapConfig } from '@/core/config'
import { createAbortError } from '@/core/abort'
import type {
  ActiveForecastRun,
  GridSpec,
  ManifestArtifactSpec,
  ManifestEncodingSpec,
  ScalarArtifactSpec,
  VectorArtifactSpec,
} from '@/forecast/manifest'
import {
  normalizeFrameId,
} from '@/forecast/manifest'
import { readArtifactPayload } from './payload'

const VECTOR_COMPONENT_PAYLOAD_FORMAT = 'linear-i8-v1'
const VECTOR_COMPONENT_DECODE_FORMULA = 'value = stored * scale + offset'

type CreateArtifactLoaderArgs = {
  config: WeatherMapConfig
  activeRun: ActiveForecastRun
  signal: AbortSignal
}

export type RasterBandOrder = 'exact' | 'by-name'

export type RawRasterBands = {
  artifactId: string
  frameId: string
  grid: GridSpec
  encoding: ManifestEncodingSpec
  bandIds: ReadonlyNonEmptyArray<string>
  bands: readonly Int8Array[]
}

export type ArtifactLoader = {
  canLoadRasterBands: (
    artifactId: string,
    bandIds: ReadonlyNonEmptyArray<string>,
    options?: { order?: RasterBandOrder }
  ) => boolean
  loadRawRasterBands: (
    artifactId: string,
    frameId: string,
    bandIds: ReadonlyNonEmptyArray<string>,
    options?: { order?: RasterBandOrder }
  ) => Promise<RawRasterBands>
}

export function createArtifactLoader(args: CreateArtifactLoaderArgs): ArtifactLoader {
  return {
    canLoadRasterBands: (artifactId, bandIds, options) => canLoadRasterBandsForRun(
      args.activeRun,
      artifactId,
      bandIds,
      options
    ),
    loadRawRasterBands: (artifactId, frameId, bandIds, options) => loadRawRasterBands({
      ...args,
      artifactId,
      frameId,
      bandIds,
      order: options?.order,
    }),
  }
}

export function canLoadRasterBandsForRun(
  activeRun: ActiveForecastRun,
  artifactId: string,
  bandIds: ReadonlyNonEmptyArray<string>,
  options?: { order?: RasterBandOrder },
): boolean {
  const artifact = activeRun.latest.artifacts[artifactId]
  if (!artifact) return false

  try {
    validateRasterBandRequest({
      artifactId,
      artifact,
      bandIds,
      order: options?.order,
    })
    return true
  } catch {
    return false
  }
}

async function loadRawRasterBands(args: {
  config: WeatherMapConfig
  activeRun: ActiveForecastRun
  signal: AbortSignal
  artifactId: string
  frameId: string
  bandIds: ReadonlyNonEmptyArray<string>
  order?: RasterBandOrder
}): Promise<RawRasterBands> {
  if (args.signal.aborted) throw createAbortError()

  const artifact = args.activeRun.latest.artifacts[args.artifactId]
  if (!artifact) {
    throw new Error(`Missing artifact ${args.artifactId}`)
  }

  validateRasterBandRequest({
    artifactId: args.artifactId,
    artifact,
    bandIds: args.bandIds,
    order: args.order,
  })

  const frameId = normalizeFrameId(args.frameId)
  const payload = await readArtifactPayload({
    config: args.config,
    activeRun: args.activeRun,
    frameId,
    artifact,
    signal: args.signal,
  })

  return extractRasterBands({
    artifactId: args.artifactId,
    frameId,
    artifact,
    payload,
    bandIds: args.bandIds,
  })
}

function validateRasterBandRequest(args: {
  artifactId: string
  artifact: ManifestArtifactSpec
  bandIds: ReadonlyNonEmptyArray<string>
  order?: RasterBandOrder
}): void {
  assertNonEmptyRasterBandIds(args.bandIds)
  if (args.artifact.kind === 'scalar') {
    assertSupportedScalarArtifact(args.artifactId, args.artifact)
    assertScalarRasterBands(args.artifactId, args.bandIds)
    return
  }

  assertSupportedVectorArtifact(args.artifactId, args.artifact)
  assertVectorRasterBands({
    artifactId: args.artifactId,
    availableComponentIds: args.artifact.components,
    requestedBandIds: args.bandIds,
    order: args.order,
  })
}

function extractRasterBands(args: {
  artifactId: string
  frameId: string
  artifact: ManifestArtifactSpec
  payload: ArrayBuffer
  bandIds: ReadonlyNonEmptyArray<string>
}): RawRasterBands {
  const {
    artifact,
    artifactId,
    bandIds,
    frameId,
    payload,
  } = args
  const { components, grid } = artifact
  const cellCount = grid.nx * grid.ny
  const expectedByteLength = cellCount * components.length

  if (payload.byteLength !== expectedByteLength) {
    const label = artifact.kind === 'scalar' ? 'Scalar' : 'Vector component'
    throw new Error(
      `${label} payload byte length mismatch for ${artifactId} ${frameId}: ` +
      `got=${payload.byteLength} expected=${expectedByteLength}`
    )
  }

  return {
    artifactId,
    frameId,
    grid,
    encoding: artifact.encoding,
    bandIds: [...bandIds] as ReadonlyNonEmptyArray<string>,
    bands: bandIds.map((bandId) => {
      const componentIndex = components.indexOf(bandId)
      if (componentIndex < 0) throw new Error(`Artifact ${artifactId} missing raster band ${bandId}`)
      return new Int8Array(payload, componentIndex * cellCount, cellCount)
    }),
  }
}

function assertSupportedScalarArtifact(
  artifactId: string,
  artifact: ScalarArtifactSpec
): void {
  const { components, encoding } = artifact
  if (components.length !== 1 || components[0] !== 'value') {
    throw new Error(`Unsupported scalar components for ${encoding.format}: ${components.join(', ')}`)
  }

  if (
    encoding.format !== 'linear-i8-v1' &&
    encoding.format !== 'temp-c-piecewise-i8-v1'
  ) {
    throw new Error(
      `Unsupported scalar format for ${artifactId}: ${(encoding as unknown as { format?: string }).format ?? 'unknown'}`
    )
  }
  if (encoding.dtype !== 'int8') {
    throw new Error(`Unsupported scalar dtype for ${artifactId}: ${encoding.dtype}`)
  }
  if (encoding.byte_order !== 'none') {
    throw new Error(`Unsupported scalar byte order for ${artifactId}: ${encoding.byte_order}`)
  }
}

function assertSupportedVectorArtifact(
  artifactId: string,
  artifact: VectorArtifactSpec
): void {
  const { components, encoding } = artifact

  if (encoding.format !== VECTOR_COMPONENT_PAYLOAD_FORMAT) {
    throw new Error(`Unsupported vector format for ${artifactId}: ${encoding.format}`)
  }
  if (encoding.dtype !== 'int8') {
    throw new Error(`Unsupported vector dtype for ${artifactId}: ${encoding.dtype}`)
  }
  if (encoding.byte_order !== 'none') {
    throw new Error(`Unsupported vector byte order for ${artifactId}: ${encoding.byte_order}`)
  }
  if (encoding.decode_formula !== VECTOR_COMPONENT_DECODE_FORMULA) {
    throw new Error(`Unsupported vector decode formula for ${artifactId}: ${encoding.decode_formula}`)
  }
  if (components.length < 1) {
    throw new Error(`Unsupported vector components for ${artifactId}: ${JSON.stringify(components)}`)
  }
}

function assertScalarRasterBands(
  artifactId: string,
  bandIds: ReadonlyNonEmptyArray<string>
): void {
  if (bandIds.length === 1 && bandIds[0] === 'value') return
  throw new Error(`Scalar artifact ${artifactId} only supports raster band value; requested ${bandIds.join(', ')}`)
}

function assertVectorRasterBands(args: {
  artifactId: string
  availableComponentIds: readonly string[]
  requestedBandIds: ReadonlyNonEmptyArray<string>
  order?: RasterBandOrder
}): void {
  if ((args.order ?? 'exact') === 'exact' && !hasOrderedComponents(args.availableComponentIds, args.requestedBandIds)) {
    throw new Error(
      `Vector artifact ${args.artifactId} requires components ${args.requestedBandIds.join(', ')}; ` +
      `got ${args.availableComponentIds.join(', ')}`
    )
  }

  const available = new Set(args.availableComponentIds)
  if (args.requestedBandIds.every((bandId) => available.has(bandId))) return
  throw new Error(`Artifact ${args.artifactId} missing raster bands`)
}

function assertNonEmptyRasterBandIds(
  bandIds: readonly string[]
): asserts bandIds is ReadonlyNonEmptyArray<string> {
  if (bandIds.length > 0) return
  throw new Error('Raster band request requires at least one band')
}

function hasOrderedComponents(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return actual.length === expected.length &&
    expected.every((component, index) => actual[index] === component)
}
