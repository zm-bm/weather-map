import type {
  FrameLoadRequest,
  ScalarEncodingSpec,
} from '../../manifest'
import {
  loadFrame,
} from '../../manifest'
import {
  getScalarCatalogEntry,
} from '../ui/catalog'
import type { ScalarFrameData } from './types'

type LoadScalarFrameArgs = FrameLoadRequest

export async function loadScalarFrame(args: LoadScalarFrameArgs): Promise<ScalarFrameData> {
  const { config, manifest, hourToken, variable, signal } = args
  const frame = await loadFrame({
    config,
    manifest,
    hourToken,
    variable,
    domain: 'scalar',
    signal,
  })
  const values = decodeScalarPayloadInt16(frame.payload, frame.encoding.byte_order)
  const catalog = getScalarCatalogEntry(variable)

  return {
    variableId: variable,
    grid: frame.grid,
    encoding: frame.encoding,
    values,
    displayRange: catalog.displayRange,
    colortable: catalog.colortable,
  }
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
