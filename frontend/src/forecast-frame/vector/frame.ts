import {
  type CycleManifest,
  type VectorEncodingSpec,
} from '../../manifest'
import type { WeatherMapConfig } from '../../config'
import { loadFramePayload, normalizeFrameHourToken } from '../loader'
import { loadFrameWindow } from '../window'
import type { ForecastFrameSelection } from '../../forecast-time'
import { resolveFrameSpec } from '../spec'
import {
  VECTOR_COMPONENTS,
  VECTOR_DECODE_FORMULA,
  VECTOR_PAYLOAD_FORMAT,
} from './types'
import {
  type VectorFrameData,
  type VectorFrameWindowData,
} from './types'

export type LoadVectorFrameArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
  variable: string
  signal: AbortSignal
}

export type LoadVectorFrameWindowArgs = ForecastFrameSelection & {
  config: WeatherMapConfig
  manifest: CycleManifest
  previousWindow?: VectorFrameWindowData | null
  variable: string
  signal: AbortSignal
}

export async function loadVectorFrame(args: LoadVectorFrameArgs): Promise<VectorFrameData> {
  const { config, manifest, hourToken, variable, signal } = args
  const normalizedHourToken = normalizeFrameHourToken(hourToken)
  const spec = resolveFrameSpec(manifest, normalizedHourToken, variable, 'vector')
  const encoding = resolveVectorEncoding(variable, spec.variable.encoding)
  assertVectorComponents(variable, spec.variable.components)
  const grid = spec.variable.grid
  const { payload, hourToken: loadedHourToken } = await loadFramePayload({
    config,
    manifest,
    frameRef: spec.frameRef,
    grid,
    hourToken: normalizedHourToken,
    variableId: variable,
    frameKind: 'vector',
    signal,
    verifyPayloadSha256: config.verifyPayloadSha256,
  })

  const componentBytes = grid.nx * grid.ny
  const u = new Int8Array(payload, 0, componentBytes)
  const v = new Int8Array(payload, componentBytes, componentBytes)

  return {
    u: new Int8Array(u),
    v: new Int8Array(v),
    metadata: {
      kind: 'vector',
      variableId: variable,
      hourToken: loadedHourToken,
      units: spec.variable.units,
      parameter: spec.variable.parameter,
      level: spec.variable.level,
      format: VECTOR_PAYLOAD_FORMAT,
      dtype: 'int8',
      byteOrder: 'none',
      scale: encoding.scale,
      offset: encoding.offset,
      decodeFormula: VECTOR_DECODE_FORMULA,
      components: [VECTOR_COMPONENTS[0], VECTOR_COMPONENTS[1]],
      gridId: grid.id,
      nx: grid.nx,
      ny: grid.ny,
      lon0: grid.lon0,
      lat0: grid.lat0,
      dx: grid.dx,
      dy: grid.dy,
    },
  }
}

export async function loadVectorFrameWindow(
  args: LoadVectorFrameWindowArgs
): Promise<VectorFrameWindowData> {
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
    loadFrame: (hourToken) => loadVectorFrame({
      config,
      manifest,
      hourToken,
      variable,
      signal,
    }),
  })
}

export function canInterpolateVectorFrames(
  lower: VectorFrameData,
  upper: VectorFrameData
): boolean {
  return (
    lower.metadata.variableId === upper.metadata.variableId &&
    lower.metadata.units === upper.metadata.units &&
    lower.metadata.parameter === upper.metadata.parameter &&
    lower.metadata.level === upper.metadata.level &&
    lower.metadata.format === upper.metadata.format &&
    lower.metadata.dtype === upper.metadata.dtype &&
    lower.metadata.byteOrder === upper.metadata.byteOrder &&
    lower.metadata.scale === upper.metadata.scale &&
    lower.metadata.offset === upper.metadata.offset &&
    lower.metadata.decodeFormula === upper.metadata.decodeFormula &&
    lower.metadata.gridId === upper.metadata.gridId &&
    lower.metadata.nx === upper.metadata.nx &&
    lower.metadata.ny === upper.metadata.ny &&
    lower.metadata.lon0 === upper.metadata.lon0 &&
    lower.metadata.lat0 === upper.metadata.lat0 &&
    lower.metadata.dx === upper.metadata.dx &&
    lower.metadata.dy === upper.metadata.dy
  )
}

function resolveVectorEncoding(
  variable: string,
  encoding: VectorEncodingSpec
): VectorEncodingSpec {
  if (encoding.format !== VECTOR_PAYLOAD_FORMAT) {
    throw new Error(`Unsupported vector format for ${variable}: ${encoding.format}`)
  }
  validateVectorEncoding(variable, encoding)
  return encoding
}

function validateVectorEncoding(
  variable: string,
  encoding: VectorEncodingSpec
): void {
  if (encoding.dtype !== 'int8') {
    throw new Error(`Unsupported vector dtype for ${variable}: ${encoding.dtype}`)
  }
  if (encoding.byteOrder !== 'none') {
    throw new Error(`Unsupported vector byte order for ${variable}: ${encoding.byteOrder}`)
  }
  if (encoding.decodeFormula !== VECTOR_DECODE_FORMULA) {
    throw new Error(`Unsupported vector decode formula for ${variable}: ${encoding.decodeFormula}`)
  }
  if (encoding.scale !== 0.5 || encoding.offset !== 0) {
    throw new Error(`Unsupported vector decode params for ${variable}: scale=${encoding.scale} offset=${encoding.offset}`)
  }
}

function assertVectorComponents(
  variable: string,
  components: readonly string[]
): asserts components is readonly ['u', 'v'] {
  if (
    components.length !== 2 ||
    components[0] !== VECTOR_COMPONENTS[0] ||
    components[1] !== VECTOR_COMPONENTS[1]
  ) {
    throw new Error(`Unsupported vector components for ${variable}: ${JSON.stringify(components)}`)
  }
}
