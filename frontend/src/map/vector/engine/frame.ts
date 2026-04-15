import {
  type FrameLoadRequest,
  loadFrame,
} from '../../manifest'
import {
  VECTOR_COMPONENT_ORDER,
  VECTOR_COMPONENTS,
  VECTOR_DECODE_FORMULA,
  VECTOR_PAYLOAD_FORMAT,
} from './types'
import {
  type VectorFrameData,
} from './types'

export type LoadVectorFrameArgs = FrameLoadRequest

export async function loadVectorFrame(args: LoadVectorFrameArgs): Promise<VectorFrameData> {
  const { config, manifest, hourToken, variable, signal } = args
  const frame = await loadFrame({
    config,
    manifest,
    hourToken,
    variable,
    domain: 'vector',
    signal,
  })

  const componentBytes = frame.grid.nx * frame.grid.ny
  const payload = new Uint8Array(frame.payload)
  const u = new Int8Array(frame.payload, 0, componentBytes)
  const v = new Int8Array(frame.payload, componentBytes, componentBytes)

  return {
    u: new Int8Array(u),
    v: new Int8Array(v),
    payload: new Uint8Array(payload),
    metadata: {
      kind: 'vector',
      variableId: variable,
      hourToken: frame.hourToken,
      units: frame.variableMeta.units,
      parameter: frame.variableMeta.parameter,
      level: frame.variableMeta.level,
      valid_min: frame.variableMeta.valid_min,
      valid_max: frame.variableMeta.valid_max,
      format: VECTOR_PAYLOAD_FORMAT,
      dtype: 'int8',
      byte_order: 'none',
      scale: frame.encoding.scale,
      offset: frame.encoding.offset,
      decode_formula: VECTOR_DECODE_FORMULA,
      components: [VECTOR_COMPONENTS[0], VECTOR_COMPONENTS[1]],
      component_count: 2,
      component_order: VECTOR_COMPONENT_ORDER,
      grid_id: frame.variableMeta.grid_id,
      nx: frame.grid.nx,
      ny: frame.grid.ny,
      lon0: frame.grid.lon0,
      lat0: frame.grid.lat0,
      dx: frame.grid.dx,
      dy: frame.grid.dy,
    },
  }
}
