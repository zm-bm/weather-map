import type {
  CycleManifest,
  FramePayloadRef,
  ManifestArtifactSpec,
  ArtifactId,
  ScalarEncodingSpec,
  ScalarArtifactSpec,
  VectorArtifactSpec,
} from '../manifest'
import { createAbortError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { readArtifactPayload } from './payload'
import type {
  ArtifactKind,
  ScalarArtifactData,
  VectorArtifactData,
} from './types'
import {
  VECTOR_COMPONENTS as VECTOR_COMPONENT_NAMES,
  VECTOR_DECODE_FORMULA as VECTOR_DECODE_FORMULA_VALUE,
  VECTOR_PAYLOAD_FORMAT as VECTOR_PAYLOAD_FORMAT_VALUE,
} from './types'

type ResolveArtifactArgs<D extends ArtifactKind> = {
  manifest: CycleManifest
  hourToken: string
  artifactId: ArtifactId | string
  kind: D
  signal: AbortSignal
}

type CreateArtifactLoaderArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  signal: AbortSignal
}

export type ArtifactLoader = {
  loadScalar: (artifactId: ArtifactId | string, hourToken: string) => Promise<ScalarArtifactData>
  loadVector: (artifactId: ArtifactId | string, hourToken: string) => Promise<VectorArtifactData>
}

type ArtifactSpecByKind = {
  scalar: ScalarArtifactSpec
  vector: VectorArtifactSpec
}

type ResolvedArtifact<D extends ArtifactKind> = {
  artifactId: string
  hourToken: string
  frameRef: FramePayloadRef
  artifact: ArtifactSpecByKind[D]
}

export function createArtifactLoader(args: CreateArtifactLoaderArgs): ArtifactLoader {
  return {
    loadScalar: async (artifactId, hourToken) => {
      const resolved = resolveArtifactForLoad({
        manifest: args.manifest,
        signal: args.signal,
        artifactId,
        hourToken,
        kind: 'scalar',
      })
      assertSupportedScalarArtifact(resolved)
      const payload = await readArtifactPayload({
        config: args.config,
        manifest: args.manifest,
        resolved,
        signal: args.signal,
      })
      return decodeScalarArtifact(resolved, payload)
    },
    loadVector: async (artifactId, hourToken) => {
      const resolved = resolveArtifactForLoad({
        manifest: args.manifest,
        signal: args.signal,
        artifactId,
        hourToken,
        kind: 'vector',
      })
      assertSupportedVectorArtifact(resolved)
      const payload = await readArtifactPayload({
        config: args.config,
        manifest: args.manifest,
        resolved,
        signal: args.signal,
      })
      return decodeVectorArtifact(resolved, payload)
    },
  }
}

function resolveArtifactForLoad<D extends ArtifactKind>(
  args: ResolveArtifactArgs<D>
): ResolvedArtifact<D> {
  if (args.signal.aborted) throw createAbortError()

  return resolveArtifact({
    manifest: args.manifest,
    hourToken: args.hourToken,
    artifactId: args.artifactId,
    kind: args.kind,
  })
}

function decodeScalarArtifact(
  resolved: ResolvedArtifact<'scalar'>,
  payload: ArrayBuffer
): ScalarArtifactData {
  const { artifactId, artifact } = resolved
  const { encoding, grid, components } = artifact
  const expectedCellCount = grid.nx * grid.ny
  const bytesPerStoredValue = encoding.dtype === 'int16' ? 2 : 1
  const expectedByteLength = expectedCellCount * components.length * bytesPerStoredValue

  if (payload.byteLength !== expectedByteLength) {
    throw new Error(
      `Scalar payload byte length mismatch for ${artifactId} ${resolved.hourToken}: ` +
      `got=${payload.byteLength} expected=${expectedByteLength}`
    )
  }

  const values = decodeScalarPayload(payload, encoding)
  if (values.length !== expectedCellCount) {
    throw new Error(
      `Scalar payload cell count mismatch for ${artifactId} ${resolved.hourToken}: ` +
      `got=${values.length} expected=${expectedCellCount}`
    )
  }

  return {
    hourToken: resolved.hourToken,
    artifactId,
    grid,
    encoding,
    values,
  }
}

function normalizeArtifactHourToken(value: string): string {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, '0')
  return trimmed
}

function decodeVectorArtifact(
  resolved: ResolvedArtifact<'vector'>,
  payload: ArrayBuffer
): VectorArtifactData {
  const { artifactId, artifact } = resolved
  const encoding = artifact.encoding
  const grid = artifact.grid

  const componentBytes = grid.nx * grid.ny
  const u = new Int8Array(payload, 0, componentBytes)
  const v = new Int8Array(payload, componentBytes, componentBytes)

  return {
    artifactId,
    hourToken: resolved.hourToken,
    scale: encoding.scale,
    offset: encoding.offset,
    u: new Int8Array(u),
    v: new Int8Array(v),
    grid,
  }
}

function resolveArtifact<D extends ArtifactKind>(
  args: {
    manifest: CycleManifest
    hourToken: string
    artifactId: ArtifactId | string
    kind: D
  }
): ResolvedArtifact<D> {
  const hourToken = normalizeArtifactHourToken(args.hourToken)
  const artifactId = String(args.artifactId)
  const artifact = resolveArtifactSpec(args.manifest, artifactId, args.kind)
  const frameRef = resolveArtifactFrameRef(artifact, hourToken, artifactId, args.kind)
  return { artifactId, hourToken, artifact, frameRef }
}

function resolveArtifactFrameRef(
  artifact: ManifestArtifactSpec,
  hourToken: string,
  artifactId: string,
  kind: ArtifactKind
): FramePayloadRef {
  return requiredValue(
    artifact.frames[hourToken],
    `No ${kind} frame ref for artifact=${artifactId} hour=${hourToken}`
  )
}

function resolveArtifactSpec<D extends ArtifactKind>(
  manifest: CycleManifest,
  artifactId: string,
  kind: D
): ArtifactSpecByKind[D] {
  const artifact = requiredValue(
    manifest.artifacts[artifactId],
    `No ${kind} artifact metadata for ${artifactId}`
  )
  if (artifact.kind !== kind) {
    throw new Error(`Artifact ${artifactId} is not ${kind} (got ${artifact.kind})`)
  }
  return artifact as ArtifactSpecByKind[D]
}

function assertSupportedScalarArtifact(resolved: ResolvedArtifact<'scalar'>): void {
  const { artifactId, artifact } = resolved
  const { components, encoding } = artifact
  if (components.length !== 1 || components[0] !== 'value') {
    throw new Error(`Unsupported scalar components for ${encoding.format}: ${components.join(', ')}`)
  }

  if (
    encoding.format !== 'linear-i16-v1' &&
    encoding.format !== 'linear-i8-v1' &&
    encoding.format !== 'temp-c-piecewise-i8-v1'
  ) {
    throw new Error(
      `Unsupported scalar format for ${artifactId}: ${(encoding as unknown as { format?: string }).format ?? 'unknown'}`
    )
  }
}

function assertSupportedVectorArtifact(resolved: ResolvedArtifact<'vector'>): void {
  const { artifactId, artifact } = resolved
  const { components, encoding } = artifact

  if (encoding.format !== VECTOR_PAYLOAD_FORMAT_VALUE) {
    throw new Error(`Unsupported vector format for ${artifactId}: ${encoding.format}`)
  }
  if (encoding.dtype !== 'int8') {
    throw new Error(`Unsupported vector dtype for ${artifactId}: ${encoding.dtype}`)
  }
  if (encoding.byteOrder !== 'none') {
    throw new Error(`Unsupported vector byte order for ${artifactId}: ${encoding.byteOrder}`)
  }
  if (encoding.decodeFormula !== VECTOR_DECODE_FORMULA_VALUE) {
    throw new Error(`Unsupported vector decode formula for ${artifactId}: ${encoding.decodeFormula}`)
  }
  if (encoding.scale !== 0.5 || encoding.offset !== 0) {
    throw new Error(`Unsupported vector decode params for ${artifactId}: scale=${encoding.scale} offset=${encoding.offset}`)
  }

  if (
    components.length !== 2 ||
    components[0] !== VECTOR_COMPONENT_NAMES[0] ||
    components[1] !== VECTOR_COMPONENT_NAMES[1]
  ) {
    throw new Error(`Unsupported vector components for ${artifactId}: ${JSON.stringify(components)}`)
  }
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

function decodeScalarPayload(
  payload: ArrayBuffer,
  encoding: ScalarEncodingSpec
): Float32Array {
  if (encoding.format === 'temp-c-piecewise-i8-v1') {
    return decodeTemperaturePiecewisePayload(payload, encoding.nodata)
  }
  if (encoding.format === 'linear-i8-v1') {
    return decodeLinearValues(decodeScalarPayloadInt8(payload, encoding.byteOrder), encoding)
  }
  if (encoding.format === 'linear-i16-v1') {
    return decodeLinearValues(decodeScalarPayloadInt16(payload, encoding.byteOrder), encoding)
  }
  throw new Error(
    `Unsupported scalar format for decoding: ${(encoding as unknown as { format?: string }).format ?? 'unknown'}`
  )
}

function decodeScalarPayloadInt8(
  payload: ArrayBuffer,
  byteOrder: Extract<ScalarEncodingSpec, { dtype: 'int8' }>['byteOrder']
): Int8Array {
  if (byteOrder !== 'none') {
    throw new Error(`Unsupported scalar byte order: ${byteOrder}`)
  }
  return new Int8Array(payload.slice(0))
}

function decodeScalarPayloadInt16(
  payload: ArrayBuffer,
  byteOrder: Extract<ScalarEncodingSpec, { dtype: 'int16' }>['byteOrder']
): Int16Array {
  if (payload.byteLength % 2 !== 0) {
    throw new Error(`Invalid int16 scalar payload byte length: ${payload.byteLength}`)
  }
  if (byteOrder === 'little') {
    return new Int16Array(payload.slice(0))
  }
  if (byteOrder === 'big') {
    const view = new DataView(payload)
    const out = new Int16Array(payload.byteLength / 2)
    for (let i = 0; i < out.length; i += 1) {
      out[i] = view.getInt16(i * 2, false)
    }
    return out
  }

  throw new Error(`Unsupported scalar byte order: ${byteOrder}`)
}

function decodeTemperaturePiecewiseStoredValue(stored: number, nodata = -128): number {
  if (stored === nodata) return Number.NaN
  const idx = stored + 127
  if (idx <= 54) return -35 + (idx * 0.5)
  if (idx <= 222) return -7.75 + ((idx - 55) * 0.25)
  return 34.5 + ((idx - 223) * 0.5)
}

function decodeTemperaturePiecewisePayload(payload: ArrayBuffer, nodata: number): Float32Array {
  const raw = new Int8Array(payload.slice(0))
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = decodeTemperaturePiecewiseStoredValue(raw[i], nodata)
  }
  return out
}

function decodeLinearValues(
  raw: Int16Array | Int8Array,
  encoding: Extract<ScalarEncodingSpec, { format: 'linear-i16-v1' | 'linear-i8-v1' }>
): Float32Array {
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    const stored = raw[i]
    out[i] = stored === encoding.nodata
      ? Number.NaN
      : (stored * encoding.scale) + encoding.offset
  }
  return out
}
