import type { ScalarEncodingSpec } from '../../manifest'
import type { CloudLayerFrameValues } from './types'

export type DecodedScalarPayload = {
  values: Float32Array
  cloudLayers?: CloudLayerFrameValues
}

type ScalarCloudLayerEncodingSpec = Extract<ScalarEncodingSpec, { components: ['low', 'medium', 'high'] }>

export function decodeScalarPayloadToValues(
  payload: ArrayBuffer,
  encoding: ScalarEncodingSpec
): Float32Array {
  return decodeScalarPayload(payload, encoding).values
}

export function decodeScalarPayload(
  payload: ArrayBuffer,
  encoding: ScalarEncodingSpec
): DecodedScalarPayload {
  if (encoding.format === 'temp-c-piecewise-i8-v1') {
    return { values: decodeTemperaturePiecewisePayload(payload, encoding.nodata) }
  }
  if (encoding.format === 'linear-i8-v1' && 'components' in encoding) {
    return decodeCloudLayerPayload(payload, encoding)
  }
  if (encoding.format === 'linear-i8-v1') {
    return { values: decodeLinearValues(decodeScalarPayloadInt8(payload, encoding.byteOrder), encoding) }
  }
  if (encoding.format === 'linear-i16-v1') {
    return { values: decodeLinearValues(decodeScalarPayloadInt16(payload, encoding.byteOrder), encoding) }
  }
  throw new Error(
    `Unsupported scalar format for decoding: ${(encoding as unknown as { format?: string }).format ?? 'unknown'}`
  )
}

export function decodeScalarPayloadInt8(
  payload: ArrayBuffer,
  byteOrder: Extract<ScalarEncodingSpec, { dtype: 'int8' }>['byteOrder']
): Int8Array {
  if (byteOrder !== 'none') {
    throw new Error(`Unsupported scalar byte order: ${byteOrder}`)
  }
  return new Int8Array(payload.slice(0))
}

export function decodeScalarPayloadInt16(
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

export function decodeCloudLayerPayload(
  payload: ArrayBuffer,
  encoding: ScalarCloudLayerEncodingSpec
): DecodedScalarPayload {
  const raw = decodeScalarPayloadInt8(payload, encoding.byteOrder)
  const componentCount = encoding.components.length
  if (raw.length % componentCount !== 0) {
    throw new Error(
      `Invalid cloud layer payload byte length: ${raw.length}; expected a multiple of ${componentCount}`
    )
  }

  const componentCellCount = raw.length / componentCount
  const low = decodeCloudLayerComponent(raw, 0, componentCellCount, encoding)
  const medium = decodeCloudLayerComponent(raw, componentCellCount, componentCellCount, encoding)
  const high = decodeCloudLayerComponent(raw, componentCellCount * 2, componentCellCount, encoding)
  const values = new Float32Array(componentCellCount)

  for (let idx = 0; idx < componentCellCount; idx += 1) {
    const lowValue = low[idx]
    const mediumValue = medium[idx]
    const highValue = high[idx]
    let maxValue = Number.isNaN(lowValue) ? Number.NaN : lowValue
    if (!Number.isNaN(mediumValue)) {
      maxValue = Number.isNaN(maxValue) ? mediumValue : Math.max(maxValue, mediumValue)
    }
    if (!Number.isNaN(highValue)) {
      maxValue = Number.isNaN(maxValue) ? highValue : Math.max(maxValue, highValue)
    }
    values[idx] = maxValue
  }

  return {
    values,
    cloudLayers: {
      low,
      medium,
      high,
    },
  }
}

function decodeCloudLayerComponent(
  raw: Int8Array,
  offset: number,
  length: number,
  encoding: ScalarCloudLayerEncodingSpec,
): Float32Array {
  const out = new Float32Array(length)
  for (let idx = 0; idx < length; idx += 1) {
    const stored = raw[offset + idx]
    out[idx] = stored === encoding.nodata
      ? Number.NaN
      : (stored * encoding.scale) + encoding.offset
  }
  return out
}
