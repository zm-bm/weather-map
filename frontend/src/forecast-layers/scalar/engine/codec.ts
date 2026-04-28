import type { ScalarEncodingSpec } from '../../../manifest'

export function decodeScalarPayloadToValues(
  payload: ArrayBuffer,
  encoding: ScalarEncodingSpec
): Float32Array {
  if (encoding.format === 'scalar-i8-temp-c-piecewise-v1') {
    return decodeTemperaturePiecewisePayload(payload, encoding.nodata)
  }
  if (encoding.format === 'scalar-i8-linear-v1') {
    return decodeLinearValues(decodeScalarPayloadInt8(payload, encoding.byte_order), encoding)
  }
  return decodeLinearValues(decodeScalarPayloadInt16(payload, encoding.byte_order), encoding)
}

export function decodeScalarPayloadInt8(
  payload: ArrayBuffer,
  byteOrder: Extract<ScalarEncodingSpec, { dtype: 'int8' }>['byte_order']
): Int8Array {
  if (byteOrder !== 'none') {
    throw new Error(`Unsupported scalar byte order: ${byteOrder}`)
  }
  return new Int8Array(payload.slice(0))
}

export function decodeScalarPayloadInt16(
  payload: ArrayBuffer,
  byteOrder: Extract<ScalarEncodingSpec, { dtype: 'int16' }>['byte_order']
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

export function decodeTemperaturePiecewiseStoredValue(stored: number, nodata = -128): number {
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
  encoding: Extract<ScalarEncodingSpec, { format: 'scalar-i16-linear-v1' | 'scalar-i8-linear-v1' }>
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
