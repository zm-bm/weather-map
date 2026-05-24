import type {
  ActiveForecastRun,
  FramePayloadRef,
  ArtifactId,
  ScalarEncodingSpec,
  ScalarArtifactSpec,
  VectorArtifactSpec,
} from '@/forecast/manifest'
import {
  normalizeForecastHourToken,
  resolveActiveRunArtifact,
  resolveActiveRunFrameRef,
} from '@/forecast/manifest'
import { createAbortError } from '@/core/abort'
import type { WeatherMapConfig } from '@/core/config'
import { readArtifactPayload } from './payload'
import type {
  ArtifactKind,
  RawVectorComponentArtifactData,
  VectorComponentArtifactData,
  ScalarArtifactData,
  VectorArtifactData,
} from './types'
import {
  WIND_VECTOR_COMPONENTS as WIND_VECTOR_COMPONENT_NAMES,
  VECTOR_DECODE_FORMULA as VECTOR_DECODE_FORMULA_VALUE,
  VECTOR_PAYLOAD_FORMAT as VECTOR_PAYLOAD_FORMAT_VALUE,
} from './types'

type ResolveArtifactArgs<D extends ArtifactKind> = {
  activeRun: ActiveForecastRun
  hourToken: string
  artifactId: ArtifactId | string
  kind: D
  signal: AbortSignal
}

type CreateArtifactLoaderArgs = {
  config: WeatherMapConfig
  activeRun: ActiveForecastRun
  signal: AbortSignal
}

export type ArtifactLoader = {
  canLoadScalar: (artifactId: ArtifactId | string) => boolean
  canLoadVector: (artifactId: ArtifactId | string) => boolean
  canLoadVectorComponents: (
    artifactId: ArtifactId | string,
    components?: readonly string[]
  ) => boolean
  loadScalar: (artifactId: ArtifactId | string, hourToken: string) => Promise<ScalarArtifactData>
  loadVector: (artifactId: ArtifactId | string, hourToken: string) => Promise<VectorArtifactData>
  loadVectorComponents: (artifactId: ArtifactId | string, hourToken: string) => Promise<VectorComponentArtifactData>
  loadRawVectorComponents: (artifactId: ArtifactId | string, hourToken: string) => Promise<RawVectorComponentArtifactData>
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
    canLoadScalar: (artifactId) => canLoadArtifact({
      activeRun: args.activeRun,
      artifactId,
      kind: 'scalar',
      assertSupported: assertSupportedScalarArtifact,
    }),
    canLoadVector: (artifactId) => canLoadArtifact({
      activeRun: args.activeRun,
      artifactId,
      kind: 'vector',
      assertSupported: assertSupportedWindVectorArtifact,
    }),
    canLoadVectorComponents: (artifactId, components) => canLoadArtifact({
      activeRun: args.activeRun,
      artifactId,
      kind: 'vector',
      assertSupported: (resolved) => {
        assertSupportedVectorComponentArtifact(resolved)
        if (components == null) return
        const available = new Set(resolved.artifact.components)
        if (!components.every((component) => available.has(component))) {
          throw new Error(`Artifact ${resolved.artifactId} missing vector components`)
        }
      },
    }),
    loadScalar: (artifactId, hourToken) => loadArtifact({
      ...args,
      artifactId,
      hourToken,
      kind: 'scalar',
      assertSupported: assertSupportedScalarArtifact,
      decode: decodeScalarArtifact,
    }),
    loadVector: (artifactId, hourToken) => loadArtifact({
      ...args,
      artifactId,
      hourToken,
      kind: 'vector',
      assertSupported: assertSupportedWindVectorArtifact,
      decode: decodeWindVectorArtifact,
    }),
    loadVectorComponents: (artifactId, hourToken) => loadArtifact({
      ...args,
      artifactId,
      hourToken,
      kind: 'vector',
      assertSupported: assertSupportedVectorComponentArtifact,
      decode: decodeVectorComponentArtifact,
    }),
    loadRawVectorComponents: (artifactId, hourToken) => loadArtifact({
      ...args,
      artifactId,
      hourToken,
      kind: 'vector',
      assertSupported: assertSupportedVectorComponentArtifact,
      decode: decodeRawVectorComponentArtifact,
    }),
  }
}

function canLoadArtifact<D extends ArtifactKind>(args: {
  activeRun: ActiveForecastRun
  artifactId: ArtifactId | string
  kind: D
  assertSupported: (resolved: ResolvedArtifact<D>) => void
}): boolean {
  const artifactId = String(args.artifactId)
  const artifact = args.activeRun.latest.artifacts[artifactId]
  if (!artifact || artifact.kind !== args.kind) return false
  const resolved = {
    artifactId,
    hourToken: '',
    frameRef: {
      path: '',
      byteLength: artifact.byteLength,
    },
    artifact,
  } as ResolvedArtifact<D>

  try {
    args.assertSupported(resolved)
    return true
  } catch {
    return false
  }
}

async function loadArtifact<D extends ArtifactKind, T>(args: ResolveArtifactArgs<D> & {
  config: WeatherMapConfig
  assertSupported: (resolved: ResolvedArtifact<D>) => void
  decode: (resolved: ResolvedArtifact<D>, payload: ArrayBuffer) => T
}): Promise<T> {
  const resolved = resolveArtifactForLoad({
    activeRun: args.activeRun,
    signal: args.signal,
    artifactId: args.artifactId,
    hourToken: args.hourToken,
    kind: args.kind,
  })
  args.assertSupported(resolved)
  const payload = await readArtifactPayload({
    config: args.config,
    activeRun: args.activeRun,
    resolved,
    signal: args.signal,
  })
  return args.decode(resolved, payload)
}

function resolveArtifactForLoad<D extends ArtifactKind>(
  args: ResolveArtifactArgs<D>
): ResolvedArtifact<D> {
  if (args.signal.aborted) throw createAbortError()

  return resolveArtifact({
    activeRun: args.activeRun,
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

function decodeWindVectorArtifact(
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

function decodeVectorComponentArtifact(
  resolved: ResolvedArtifact<'vector'>,
  payload: ArrayBuffer
): VectorComponentArtifactData {
  const { artifactId, artifact } = resolved
  const { components: componentIds, encoding, grid } = artifact
  const cellCount = grid.nx * grid.ny
  const expectedByteLength = cellCount * componentIds.length

  if (payload.byteLength !== expectedByteLength) {
    throw new Error(
      `Vector component payload byte length mismatch for ${artifactId} ${resolved.hourToken}: ` +
      `got=${payload.byteLength} expected=${expectedByteLength}`
    )
  }

  const components: Record<string, Float32Array> = {}
  for (const [componentIndex, componentId] of componentIds.entries()) {
    const componentOffset = componentIndex * cellCount
    const raw = new Int8Array(payload, componentOffset, cellCount)
    components[componentId] = decodeVectorComponentValues(raw, encoding)
  }

  return {
    artifactId,
    hourToken: resolved.hourToken,
    grid,
    encoding,
    componentIds: [...componentIds],
    components,
  }
}

function decodeRawVectorComponentArtifact(
  resolved: ResolvedArtifact<'vector'>,
  payload: ArrayBuffer
): RawVectorComponentArtifactData {
  const { artifactId, artifact } = resolved
  const { components: componentIds, encoding, grid } = artifact
  const cellCount = grid.nx * grid.ny
  const expectedByteLength = cellCount * componentIds.length

  if (payload.byteLength !== expectedByteLength) {
    throw new Error(
      `Vector component payload byte length mismatch for ${artifactId} ${resolved.hourToken}: ` +
      `got=${payload.byteLength} expected=${expectedByteLength}`
    )
  }

  const components: Record<string, Int8Array> = {}
  for (const [componentIndex, componentId] of componentIds.entries()) {
    const componentOffset = componentIndex * cellCount
    const raw = new Int8Array(payload, componentOffset, cellCount)
    components[componentId] = new Int8Array(raw)
  }

  return {
    artifactId,
    hourToken: resolved.hourToken,
    grid,
    encoding,
    componentIds: [...componentIds],
    components,
  }
}

function resolveArtifact<D extends ArtifactKind>(
  args: {
    activeRun: ActiveForecastRun
    hourToken: string
    artifactId: ArtifactId | string
    kind: D
  }
): ResolvedArtifact<D> {
  const hourToken = normalizeForecastHourToken(args.hourToken)
  const artifactId = String(args.artifactId)
  const artifact = resolveActiveRunArtifact(args.activeRun, artifactId, args.kind)
  const frameRef = resolveActiveRunFrameRef({
    activeRun: args.activeRun,
    artifactId,
    hourToken,
    kind: args.kind,
  })
  return { artifactId, hourToken, artifact, frameRef }
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

function assertSupportedVectorComponentArtifact(resolved: ResolvedArtifact<'vector'>): void {
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
  if (components.length < 1) {
    throw new Error(`Unsupported vector components for ${artifactId}: ${JSON.stringify(components)}`)
  }
}

function assertSupportedWindVectorArtifact(resolved: ResolvedArtifact<'vector'>): void {
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
    components[0] !== WIND_VECTOR_COMPONENT_NAMES[0] ||
    components[1] !== WIND_VECTOR_COMPONENT_NAMES[1]
  ) {
    throw new Error(`Unsupported vector components for ${artifactId}: ${JSON.stringify(components)}`)
  }
}

function decodeVectorComponentValues(
  raw: Int8Array,
  encoding: ResolvedArtifact<'vector'>['artifact']['encoding']
): Float32Array {
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    const stored = raw[i]
    out[i] = encoding.nodata != null && stored === encoding.nodata
      ? Number.NaN
      : (stored * encoding.scale) + encoding.offset
  }
  return out
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
