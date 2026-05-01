import {
  type CycleManifest,
  type ManifestEncodingSpec,
  type VectorEncodingSpec,
} from '../../manifest'
import type { WeatherMapConfig } from '../../config'
import { loadFramePayload, normalizeFrameHourToken } from '../loader'
import { loadFrameWindow } from '../window'
import type { ForecastFrameSelection } from '../../forecast-time'
import { resolveFrameSpec } from '../spec'
import {
  VECTOR_COMPONENT_ORDER,
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
  const encoding = resolveVectorEncoding(variable, spec.encoding)
  const { payload, hourToken: loadedHourToken } = await loadFramePayload({
    config,
    manifest,
    frameRef: spec.frameRef,
    grid: spec.grid,
    hourToken: normalizedHourToken,
    variableId: variable,
    frameKind: 'vector',
    signal,
    verifyPayloadSha256: config.verifyPayloadSha256,
  })

  const componentBytes = spec.grid.nx * spec.grid.ny
  const u = new Int8Array(payload, 0, componentBytes)
  const v = new Int8Array(payload, componentBytes, componentBytes)

  return {
    u: new Int8Array(u),
    v: new Int8Array(v),
    metadata: {
      kind: 'vector',
      variableId: variable,
      hourToken: loadedHourToken,
      units: spec.variableMeta.units,
      parameter: spec.variableMeta.parameter,
      level: spec.variableMeta.level,
      valid_min: spec.variableMeta.valid_min,
      valid_max: spec.variableMeta.valid_max,
      format: VECTOR_PAYLOAD_FORMAT,
      dtype: 'int8',
      byte_order: 'none',
      scale: encoding.scale,
      offset: encoding.offset,
      decode_formula: VECTOR_DECODE_FORMULA,
      components: [VECTOR_COMPONENTS[0], VECTOR_COMPONENTS[1]],
      component_count: 2,
      component_order: VECTOR_COMPONENT_ORDER,
      grid_id: spec.variableMeta.grid_id,
      nx: spec.grid.nx,
      ny: spec.grid.ny,
      lon0: spec.grid.lon0,
      lat0: spec.grid.lat0,
      dx: spec.grid.dx,
      dy: spec.grid.dy,
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
    lower.metadata.byte_order === upper.metadata.byte_order &&
    lower.metadata.scale === upper.metadata.scale &&
    lower.metadata.offset === upper.metadata.offset &&
    lower.metadata.decode_formula === upper.metadata.decode_formula &&
    lower.metadata.grid_id === upper.metadata.grid_id &&
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
  encoding: ManifestEncodingSpec
): VectorEncodingSpec {
  if (encoding.format !== VECTOR_PAYLOAD_FORMAT) {
    throw new Error(`Unsupported vector format for ${variable}: ${encoding.format}`)
  }
  if (!('components' in encoding) || !('component_count' in encoding) || !('component_order' in encoding)) {
    throw new Error(`Vector encoding for ${variable} is missing component metadata`)
  }
  assertVectorEncoding(variable, encoding)
  return encoding
}

function assertVectorEncoding(variable: string, encoding: VectorEncodingSpec) {
  if (encoding.dtype !== 'int8') {
    throw new Error(`Unsupported vector dtype for ${variable}: ${encoding.dtype}`)
  }
  if (encoding.byte_order !== 'none') {
    throw new Error(`Unsupported vector byte order for ${variable}: ${encoding.byte_order}`)
  }
  if (encoding.component_order !== VECTOR_COMPONENT_ORDER) {
    throw new Error(`Unsupported vector component order for ${variable}: ${encoding.component_order}`)
  }
  if (encoding.component_count !== 2) {
    throw new Error(`Unsupported vector component count for ${variable}: ${encoding.component_count}`)
  }
  if (
    !Array.isArray(encoding.components) ||
    encoding.components.length !== 2 ||
    encoding.components[0] !== VECTOR_COMPONENTS[0] ||
    encoding.components[1] !== VECTOR_COMPONENTS[1]
  ) {
    throw new Error(`Unsupported vector components for ${variable}: ${JSON.stringify(encoding.components)}`)
  }
  if (encoding.decode_formula !== VECTOR_DECODE_FORMULA) {
    throw new Error(`Unsupported vector decode formula for ${variable}: ${encoding.decode_formula}`)
  }
  if (encoding.scale !== 0.5 || encoding.offset !== 0) {
    throw new Error(`Unsupported vector decode params for ${variable}: scale=${encoding.scale} offset=${encoding.offset}`)
  }
}
