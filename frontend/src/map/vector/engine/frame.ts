import {
  type CycleManifest,
  type ManifestEncodingSpec,
  type VectorEncodingSpec,
} from '../../../manifest'
import type { WeatherMapConfig } from '../../../config'
import { loadFramePayload, normalizeFrameHourToken } from '../../frame/loader'
import { resolveFrameSpec } from '../../frame/spec'
import {
  VECTOR_COMPONENT_ORDER,
  VECTOR_COMPONENTS,
  VECTOR_DECODE_FORMULA,
  VECTOR_PAYLOAD_FORMAT,
} from './types'
import {
  type VectorFrameData,
} from './types'

export type LoadVectorFrameArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
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
    frameRef: spec.frameRef,
    grid: spec.grid,
    hourToken: normalizedHourToken,
    variable,
    domain: 'vector',
    signal,
    verifySha256: config.verifyScalarSha256,
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
