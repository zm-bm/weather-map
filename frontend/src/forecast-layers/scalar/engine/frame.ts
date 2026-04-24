import type {
  CycleManifest,
  ManifestEncodingSpec,
  ScalarEncodingSpec,
} from '../../../manifest'
import type { WeatherMapConfig } from '../../../config'
import { loadFramePayload, normalizeFrameHourToken } from '../../../forecast-frame/loader'
import { loadFrameWindow } from '../../../forecast-frame/window'
import type { ForecastFrameSelection } from '../../../forecast-time/time'
import { resolveFrameSpec } from '../../../forecast-frame/spec'
import { getScalarStyle } from '../../../forecast-metadata/scalar'
import type { ScalarFrameData, ScalarFrameWindowData } from './types'

export type LoadScalarFrameArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
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
  const { config, manifest, hourToken, variable, signal } = args
  const normalizedHourToken = normalizeFrameHourToken(hourToken)
  const spec = resolveFrameSpec(manifest, normalizedHourToken, variable, 'scalar')
  const encoding = resolveScalarEncoding(variable, spec.encoding)
  const { payload } = await loadFramePayload({
    config,
    manifest,
    frameRef: spec.frameRef,
    grid: spec.grid,
    hourToken: normalizedHourToken,
    variableId: variable,
    frameKind: 'scalar',
    signal,
    verifyPayloadSha256: config.verifyPayloadSha256,
  })
  const values = decodeScalarPayloadInt16(payload, encoding.byte_order)
  const catalog = getScalarStyle(variable)

  return {
    hourToken: normalizedHourToken,
    variableId: variable,
    grid: spec.grid,
    encoding,
    values,
    displayRange: catalog.displayRange,
    colortable: catalog.colortable,
  }
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

export function canInterpolateScalarFrames(
  lower: ScalarFrameData,
  upper: ScalarFrameData
): boolean {
  if (lower.variableId !== upper.variableId) return false
  if (lower.grid.nx !== upper.grid.nx || lower.grid.ny !== upper.grid.ny) return false
  if (lower.grid.lon0 !== upper.grid.lon0 || lower.grid.lat0 !== upper.grid.lat0) return false
  if (lower.grid.dx !== upper.grid.dx || lower.grid.dy !== upper.grid.dy) return false
  if (lower.grid.x_wrap !== upper.grid.x_wrap || lower.grid.y_mode !== upper.grid.y_mode) return false
  if (lower.encoding.scale !== upper.encoding.scale || lower.encoding.offset !== upper.encoding.offset) return false
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

  return true
}

function resolveScalarEncoding(
  variable: string,
  encoding: ManifestEncodingSpec
): ScalarEncodingSpec {
  if (encoding.format !== 'scalar-i16-linear-v1') {
    throw new Error(`Unsupported scalar format for ${variable}: ${encoding.format}`)
  }
  if (!('nodata' in encoding)) {
    throw new Error(`Scalar encoding for ${variable} is missing nodata`)
  }
  return encoding
}

export function decodeScalarPayloadInt16(
  payload: ArrayBuffer,
  byteOrder: ScalarEncodingSpec['byte_order']
): Int16Array {
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
