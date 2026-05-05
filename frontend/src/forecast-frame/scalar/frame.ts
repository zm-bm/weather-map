import type {
  CycleManifest,
  ManifestEncodingSpec,
  ScalarEncodingSpec,
} from '../../manifest'
import { createAbortError } from '../../abort'
import type { WeatherMapConfig } from '../../config'
import { loadFramePayload, normalizeFrameHourToken } from '../loader'
import { loadFrameWindow } from '../window'
import type { ForecastFrameSelection } from '../../forecast-time'
import { resolveFrameSpec } from '../spec'
import { getScalarStyle } from '../../forecast-metadata/scalar'
import { decodeScalarPayload } from './codec'
import type { ScalarFrameData, ScalarFrameWindowData } from './types'

const DECODED_SCALAR_FRAME_CACHE_LIMIT = 6
const decodedScalarFrameCache = new Map<string, ScalarFrameData>()

export type LoadScalarFrameArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
  variable: string
  signal: AbortSignal
}

export type PrefetchScalarFramesArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourTokens: string[]
  variable: string
  signal: AbortSignal
}

export type LoadScalarFrameWindowArgs = ForecastFrameSelection & {
  config: WeatherMapConfig
  manifest: CycleManifest
  previousWindow?: ScalarFrameWindowData | null
  variable: string
  signal: AbortSignal
}

export async function loadScalarFrame(args: LoadScalarFrameArgs): Promise<ScalarFrameData> {
  if (args.signal.aborted) throw createAbortError()

  const { config, manifest, hourToken, variable, signal } = args
  const normalizedHourToken = normalizeFrameHourToken(hourToken)
  const cacheKey = decodedScalarFrameCacheKey(manifest, variable, normalizedHourToken)
  const cachedFrame = getDecodedScalarFrame(cacheKey)
  if (cachedFrame) return cachedFrame

  const spec = resolveFrameSpec(manifest, normalizedHourToken, variable, 'scalar')
  const encoding = resolveScalarEncoding(variable, spec.variable.encoding)
  const grid = spec.variable.grid
  const components = spec.variable.components
  const { payload } = await loadFramePayload({
    config,
    manifest,
    frameRef: spec.frameRef,
    grid,
    hourToken: normalizedHourToken,
    variableId: variable,
    frameKind: 'scalar',
    signal,
    verifyPayloadSha256: config.verifyPayloadSha256,
  })
  if (signal.aborted) throw createAbortError()

  const expectedCellCount = grid.nx * grid.ny
  const bytesPerStoredValue = encoding.dtype === 'int16' ? 2 : 1
  const expectedByteLength = expectedCellCount * components.length * bytesPerStoredValue
  if (payload.byteLength !== expectedByteLength) {
    throw new Error(
      `Scalar payload byte length mismatch for ${variable} ${normalizedHourToken}: ` +
      `got=${payload.byteLength} expected=${expectedByteLength}`
    )
  }

  const decoded = decodeScalarPayload(payload, encoding, components)
  const { values, cloudLayers } = decoded
  if (values.length !== expectedCellCount) {
    throw new Error(
      `Scalar payload cell count mismatch for ${variable} ${normalizedHourToken}: ` +
      `got=${values.length} expected=${expectedCellCount}`
    )
  }
  const style = getScalarStyle(spec.variable)

  const frame = {
    hourToken: normalizedHourToken,
    variableId: variable,
    paletteId: spec.variable.style.paletteId,
    grid,
    encoding,
    values,
    cloudLayers,
    displayRange: [spec.variable.valueRange.min, spec.variable.valueRange.max] as [number, number],
    colortable: style.colortable,
  }
  setDecodedScalarFrame(cacheKey, frame)

  return frame
}

export async function prefetchScalarFrames(args: PrefetchScalarFramesArgs): Promise<void> {
  await Promise.all(
    uniqueNormalizedHourTokens(args.hourTokens).map((hourToken) => loadScalarFrame({
      config: args.config,
      manifest: args.manifest,
      hourToken,
      variable: args.variable,
      signal: args.signal,
    }))
  )
}

export async function loadScalarFrameWindow(
  args: LoadScalarFrameWindowArgs
): Promise<ScalarFrameWindowData> {
  const {
    config,
    manifest,
    previousWindow,
    variable,
    signal,
  } = args

  return loadFrameWindow({
    selection: args,
    previousWindow,
    loadFrame: (hourToken) => loadScalarFrame({
      config,
      manifest,
      hourToken,
      variable,
      signal,
    }),
  })
}

export function clearDecodedScalarFrameCache() {
  decodedScalarFrameCache.clear()
}

export function decodedScalarFrameCacheKey(
  manifest: CycleManifest,
  variable: string,
  hourToken: string
): string {
  return `${manifest.run.cycle}:${manifest.run.revision}:${variable}:${normalizeFrameHourToken(hourToken)}`
}

function getDecodedScalarFrame(cacheKey: string): ScalarFrameData | null {
  const frame = decodedScalarFrameCache.get(cacheKey)
  if (!frame) return null

  decodedScalarFrameCache.delete(cacheKey)
  decodedScalarFrameCache.set(cacheKey, frame)
  return frame
}

function setDecodedScalarFrame(cacheKey: string, frame: ScalarFrameData): void {
  if (decodedScalarFrameCache.has(cacheKey)) {
    decodedScalarFrameCache.delete(cacheKey)
  }

  decodedScalarFrameCache.set(cacheKey, frame)

  while (decodedScalarFrameCache.size > DECODED_SCALAR_FRAME_CACHE_LIMIT) {
    const oldestKey = decodedScalarFrameCache.keys().next().value
    if (oldestKey == null) return
    decodedScalarFrameCache.delete(oldestKey)
  }
}

function uniqueNormalizedHourTokens(hourTokens: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const hourToken of hourTokens) {
    const normalized = normalizeFrameHourToken(hourToken)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

export function canInterpolateScalarFrames(
  lower: ScalarFrameData,
  upper: ScalarFrameData
): boolean {
  if (lower.variableId !== upper.variableId) return false
  if (lower.paletteId !== upper.paletteId) return false
  if (lower.grid.nx !== upper.grid.nx || lower.grid.ny !== upper.grid.ny) return false
  if (lower.grid.lon0 !== upper.grid.lon0 || lower.grid.lat0 !== upper.grid.lat0) return false
  if (lower.grid.dx !== upper.grid.dx || lower.grid.dy !== upper.grid.dy) return false
  if (lower.grid.xWrap !== upper.grid.xWrap || lower.grid.yMode !== upper.grid.yMode) return false
  if (lower.encoding.format !== upper.encoding.format) return false
  if (Boolean(lower.cloudLayers) !== Boolean(upper.cloudLayers)) return false
  if ('scale' in lower.encoding || 'scale' in upper.encoding) {
    if (!('scale' in lower.encoding) || !('scale' in upper.encoding)) return false
    if (lower.encoding.scale !== upper.encoding.scale || lower.encoding.offset !== upper.encoding.offset) return false
  }
  if (lower.encoding.nodata !== upper.encoding.nodata) return false
  if (lower.displayRange[0] !== upper.displayRange[0] || lower.displayRange[1] !== upper.displayRange[1]) return false
  if (lower.colortable.length !== upper.colortable.length) return false

  for (let idx = 0; idx < lower.colortable.length; idx += 1) {
    const lowerStop = lower.colortable[idx]
    const upperStop = upper.colortable[idx]
    if (lowerStop.length !== upperStop.length) return false
    for (let partIdx = 0; partIdx < lowerStop.length; partIdx += 1) {
      if (lowerStop[partIdx] !== upperStop[partIdx]) return false
    }
  }
  if (lower.cloudLayers && upper.cloudLayers) {
    const expectedCellCount = lower.grid.nx * lower.grid.ny
    for (const component of ['low', 'medium', 'high'] as const) {
      if (lower.cloudLayers[component].length !== expectedCellCount) return false
      if (upper.cloudLayers[component].length !== expectedCellCount) return false
    }
  }

  return true
}

function resolveScalarEncoding(
  variable: string,
  encoding: ManifestEncodingSpec
): ScalarEncodingSpec {
  const encodingFormat = (encoding as { format?: string }).format
  if (
    encodingFormat !== 'linear-i16-v1' &&
    encodingFormat !== 'linear-i8-v1' &&
    encodingFormat !== 'temp-c-piecewise-i8-v1'
  ) {
    throw new Error(`Unsupported scalar format for ${variable}: ${encodingFormat}`)
  }
  if (!('nodata' in encoding)) {
    throw new Error(`Scalar encoding for ${variable} is missing nodata`)
  }
  return encoding
}
