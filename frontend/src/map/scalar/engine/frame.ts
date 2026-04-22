import type {
  CycleManifest,
  ManifestEncodingSpec,
  ScalarEncodingSpec,
} from '../../../manifest'
import type { WeatherMapConfig } from '../../config'
import { loadFramePayload, normalizeFrameHourToken } from '../../frame/loader'
import { resolveFrameSpec } from '../../frame/spec'
import {
  getScalarCatalogEntry,
} from '../ui/catalog'
import type { ScalarFrameData } from './types'

export type LoadScalarFrameArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
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
    frameRef: spec.frameRef,
    grid: spec.grid,
    hourToken: normalizedHourToken,
    variable,
    domain: 'scalar',
    signal,
    verifySha256: config.verifyScalarSha256,
  })
  const values = decodeScalarPayloadInt16(payload, encoding.byte_order)
  const catalog = getScalarCatalogEntry(variable)

  return {
    variableId: variable,
    grid: spec.grid,
    encoding,
    values,
    displayRange: catalog.displayRange,
    colortable: catalog.colortable,
  }
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
