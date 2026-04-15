import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'
import * as twgl from 'twgl.js'

import {
  createControllerRegistry,
  type FrameRuntimeController,
  asWebGL2,
  clamp,
} from '../../shared'
import type { VectorFrameData } from './types'
import {
  VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
  VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
  VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE,
  VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
} from './shaders'
import {
  PARTICLE_COUNT,
  SPEED_REFERENCE_ZOOM,
  VISUAL_SPEED_MULTIPLIER,
  EARTH_DEG_PER_METER,
  MAX_PARTICLE_AGE_SEC,
  DASH_POINT_SIZE,
  DASH_COLOR,
  DASH_DIRECTION_STEP_SEC,
  DASH_MIN_LENGTH_PX,
  DASH_MAX_LENGTH_PX,
  DASH_LEN_PER_MPS,
  DASH_WIDTH_PX
} from './constants'
import { DEFAULT_VECTOR_RUNTIME_OPTIONS, type VectorRuntimeOptions } from '../options'

export type VectorRuntimeController = FrameRuntimeController<VectorFrameData>

const vectorRuntimeControllers = createControllerRegistry<VectorRuntimeController>()

export function getVectorRuntimeController(map: MapLibreMap): VectorRuntimeController | null {
  return vectorRuntimeControllers.get(map)
}

function registerVectorRuntimeController(map: MapLibreMap, controller: VectorRuntimeController) {
  vectorRuntimeControllers.register(map, controller)
}

function unregisterVectorRuntimeController(map: MapLibreMap) {
  vectorRuntimeControllers.unregister(map)
}

type ViewportState = {
  west: number
  east: number
  south: number
  north: number
  mercatorWestX: number
  mercatorEastX: number
  mercatorNorthY: number
  mercatorSouthY: number
}

type VectorLayerState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  lastFrameMs: number
  particleCount: number
  viewport: ViewportState | null
  vectorU: Int8Array
  vectorV: Int8Array
  vectorNx: number
  vectorNy: number
  vectorLon0: number
  vectorLat0: number
  vectorDx: number
  vectorDy: number
  vectorTexture: WebGLTexture | null
  available: boolean
  hasFrame: boolean
  updateProgramInfo: twgl.ProgramInfo | null
  particleProgramInfo: twgl.ProgramInfo | null
  stateBufferInfos: [twgl.BufferInfo | null, twgl.BufferInfo | null]
  activeSourceIndex: 0 | 1
  transformFeedback: WebGLTransformFeedback | null
}

export type VectorLayerRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    _input: CustomRenderMethodInput
  ) => void
  onRemove: (_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createVectorRuntime(
  options: VectorRuntimeOptions = DEFAULT_VECTOR_RUNTIME_OPTIONS
): VectorLayerRuntime {
  const state: VectorLayerState = {
    lastFrameMs: 0,
    particleCount: PARTICLE_COUNT,
    viewport: null,
    vectorU: new Int8Array(0),
    vectorV: new Int8Array(0),
    vectorNx: 0,
    vectorNy: 0,
    vectorLon0: 0,
    vectorLat0: 0,
    vectorDx: 1,
    vectorDy: -1,
    vectorTexture: null,
    available: false,
    hasFrame: false,
    updateProgramInfo: null,
    particleProgramInfo: null,
    stateBufferInfos: [null, null],
    activeSourceIndex: 0,
    transformFeedback: null,
  }
  const runtimeController: VectorRuntimeController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Vector runtime unavailable (WebGL2 required)')
      applyVectorFieldToState(state, frame, options)
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerVectorRuntimeController(map, runtimeController)

      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) {
        state.available = false
        console.warn('[vector] WebGL2 is required for GPU particle simulation')
        return
      }

      state.gl = gl2
      state.lastFrameMs = performance.now()
      state.viewport = computeViewportState(map)

      state.updateProgramInfo = createProgramInfo(
        gl2,
        VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
        VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE,
        'update',
        {
          transformFeedbackVaryings: ['v_state'],
          transformFeedbackMode: gl2.SEPARATE_ATTRIBS,
        },
      )

      state.particleProgramInfo = createProgramInfo(
        gl2,
        VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
        VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
        'particle',
      )

      if (!state.updateProgramInfo || !state.particleProgramInfo) {
        state.available = false
        return
      }

      const initial = buildInitialParticleState(state.particleCount, state.viewport)
      state.stateBufferInfos = [
        createStateBufferInfo(gl2, initial),
        createStateBufferInfo(gl2, initial),
      ]
      if (!state.stateBufferInfos[0] || !state.stateBufferInfos[1]) {
        state.available = false
        return
      }

      state.transformFeedback = gl2.createTransformFeedback()
      if (!state.transformFeedback) {
        state.available = false
        return
      }
      state.available = true

      map.triggerRepaint()
    },

    render(gl) {
      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) return
      if (!state.available || !state.hasFrame) return
      if (!isReady(state)) return
      if (!state.map) return

      state.viewport = computeViewportState(state.map)

      const now = performance.now()
      const dtSec = clamp((now - state.lastFrameMs) / 1000, 0.001, 0.05)
      state.lastFrameMs = now

      runUpdatePass(state, dtSec, now)
      runParticlePass(state)

      state.map.triggerRepaint()
    },

    onRemove(map, gl) {
      unregisterVectorRuntimeController(map)
      void gl
      const gl2 = state.gl

      if (gl2) {
        if (state.vectorTexture) gl2.deleteTexture(state.vectorTexture)
        if (state.updateProgramInfo) gl2.deleteProgram(state.updateProgramInfo.program)
        if (state.particleProgramInfo) gl2.deleteProgram(state.particleProgramInfo.program)
        if (state.stateBufferInfos[0]) {
          const buffer = getStateBufferFromInfo(state.stateBufferInfos[0])
          if (buffer) gl2.deleteBuffer(buffer)
        }
        if (state.stateBufferInfos[1]) {
          const buffer = getStateBufferFromInfo(state.stateBufferInfos[1])
          if (buffer) gl2.deleteBuffer(buffer)
        }
        if (state.transformFeedback) gl2.deleteTransformFeedback(state.transformFeedback)
      }

      state.map = undefined
      state.gl = undefined
      state.viewport = null
      state.vectorTexture = null
      state.available = false
      state.hasFrame = false
      state.updateProgramInfo = null
      state.particleProgramInfo = null
      state.stateBufferInfos = [null, null]
      state.transformFeedback = null
    },
  }
}

function applyVectorFieldToState(
  state: VectorLayerState,
  vectorField: VectorFrameData,
  options: VectorRuntimeOptions,
) {
  const gl = state.gl
  if (!gl) return

  const samplingOrigin = toCellCenterOrigin(
    vectorField.metadata.lon0,
    vectorField.metadata.lat0,
    vectorField.metadata.dx,
    vectorField.metadata.dy,
  )

  state.vectorU = vectorField.u
  state.vectorV = vectorField.v
  state.vectorNx = vectorField.metadata.nx
  state.vectorNy = vectorField.metadata.ny
  state.vectorLon0 = samplingOrigin.lon0
  state.vectorLat0 = samplingOrigin.lat0
  state.vectorDx = vectorField.metadata.dx
  state.vectorDy = vectorField.metadata.dy

  const nextTexture = createVectorTexture(gl, state)
  if (!nextTexture) {
    console.warn('[vector] failed to upload live vector texture; keeping previous texture')
    return
  }

  if (state.vectorTexture) gl.deleteTexture(state.vectorTexture)
  state.vectorTexture = nextTexture
  state.hasFrame = true
  if (options.reseedOnFrameChange) {
    reseedParticles(state)
    state.activeSourceIndex = 0
  }
  state.lastFrameMs = performance.now()
}

function runUpdatePass(state: VectorLayerState, dtSec: number, nowMs: number) {
  const {
    gl,
    updateProgramInfo,
    vectorTexture,
    transformFeedback,
    stateBufferInfos,
    activeSourceIndex,
    particleCount,
    viewport,
    map,
  } = state
  if (
    !gl ||
    !updateProgramInfo ||
    !vectorTexture ||
    !transformFeedback ||
    !stateBufferInfos[0] ||
    !stateBufferInfos[1] ||
    !viewport
  ) {
    return
  }

  const srcBufferInfo = stateBufferInfos[activeSourceIndex]
  const dstBufferInfo = stateBufferInfos[activeSourceIndex === 0 ? 1 : 0]
  if (!srcBufferInfo || !dstBufferInfo) return

  const dstBuffer = getStateBufferFromInfo(dstBufferInfo)
  if (!dstBuffer) return

  const zoom = map?.getZoom() ?? SPEED_REFERENCE_ZOOM
  gl.useProgram(updateProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, updateProgramInfo, srcBufferInfo)
  twgl.setUniforms(updateProgramInfo, {
    u_dt_sec: dtSec,
    u_seed: nowMs * 0.001,
    u_lon0: state.vectorLon0,
    u_lat0: state.vectorLat0,
    u_dx: state.vectorDx,
    u_dy: state.vectorDy,
    u_vector_size: [state.vectorNx, state.vectorNy],
    u_speed_multiplier: VISUAL_SPEED_MULTIPLIER,
    u_zoom_scale: Math.pow(2, SPEED_REFERENCE_ZOOM - zoom),
    u_deg_per_meter: EARTH_DEG_PER_METER,
    u_max_age_sec: MAX_PARTICLE_AGE_SEC,
    u_bounds_west: viewport.west,
    u_bounds_east: viewport.east,
    u_bounds_south: viewport.south,
    u_bounds_north: viewport.north,
    u_vector_tex: vectorTexture,
  })

  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback)
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dstBuffer)

  gl.enable(gl.RASTERIZER_DISCARD)
  gl.beginTransformFeedback(gl.POINTS)
  twgl.drawBufferInfo(gl, srcBufferInfo, gl.POINTS, particleCount)
  gl.endTransformFeedback()
  gl.disable(gl.RASTERIZER_DISCARD)

  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
  gl.useProgram(null)

  state.activeSourceIndex = activeSourceIndex === 0 ? 1 : 0
}

function runParticlePass(state: VectorLayerState) {
  const {
    gl,
    viewport,
    vectorTexture,
    particleProgramInfo,
    stateBufferInfos,
    activeSourceIndex,
    particleCount,
    map,
  } = state
  if (
    !gl ||
    !viewport ||
    !vectorTexture ||
    !particleProgramInfo ||
    !stateBufferInfos[activeSourceIndex] ||
    !map
  ) {
    return
  }

  const particleBufferInfo = stateBufferInfos[activeSourceIndex]
  if (!particleBufferInfo) return

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.disable(gl.DEPTH_TEST)

  gl.useProgram(particleProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, particleProgramInfo, particleBufferInfo)

  const zoom = map.getZoom()
  twgl.setUniforms(particleProgramInfo, {
    u_bounds_west: viewport.west,
    u_bounds_east: viewport.east,
    u_mercator_bounds: [
      viewport.mercatorWestX,
      viewport.mercatorEastX,
      viewport.mercatorNorthY,
      viewport.mercatorSouthY,
    ],
    u_point_size: DASH_POINT_SIZE,
    u_color: DASH_COLOR,
    u_lon0: state.vectorLon0,
    u_lat0: state.vectorLat0,
    u_dx: state.vectorDx,
    u_dy: state.vectorDy,
    u_vector_size: [state.vectorNx, state.vectorNy],
    u_deg_per_meter: EARTH_DEG_PER_METER,
    u_dir_step_sec: DASH_DIRECTION_STEP_SEC,
    u_speed_multiplier: VISUAL_SPEED_MULTIPLIER,
    u_zoom_scale: Math.pow(2, SPEED_REFERENCE_ZOOM - zoom),
    u_dash_min_len_px: DASH_MIN_LENGTH_PX,
    u_dash_max_len_px: DASH_MAX_LENGTH_PX,
    u_dash_len_per_mps: DASH_LEN_PER_MPS,
    u_dash_width_px: DASH_WIDTH_PX,
    u_vector_tex: vectorTexture,
  })

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  twgl.drawBufferInfo(gl, particleBufferInfo, gl.POINTS, particleCount)

  gl.disable(gl.BLEND)
  gl.useProgram(null)
}

function reseedParticles(state: VectorLayerState) {
  const { gl, viewport, stateBufferInfos, particleCount } = state
  if (!gl || !viewport || !stateBufferInfos[0] || !stateBufferInfos[1]) return

  const stateBuffer0 = getStateBufferFromInfo(stateBufferInfos[0])
  const stateBuffer1 = getStateBufferFromInfo(stateBufferInfos[1])
  if (!stateBuffer0 || !stateBuffer1) return

  const seeded = buildInitialParticleState(particleCount, viewport)
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer0)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer1)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

function buildInitialParticleState(count: number, viewport: ViewportState | null): Float32Array {
  const out = new Float32Array(count * 3)
  if (!viewport) return out

  for (let i = 0; i < count; i += 1) {
    const base = i * 3
    const lon = viewport.west + Math.random() * (viewport.east - viewport.west)
    const lat = viewport.south + Math.random() * (viewport.north - viewport.south)
    out[base] = lon > 180 ? lon - 360 : lon
    out[base + 1] = lat
    out[base + 2] = Math.random() * MAX_PARTICLE_AGE_SEC
  }
  return out
}

function createStateBufferInfo(gl: WebGL2RenderingContext, data: Float32Array) {
  return twgl.createBufferInfoFromArrays(gl, {
    a_state: {
      numComponents: 3,
      data,
      drawType: gl.DYNAMIC_DRAW,
    },
  })
}

function getStateBufferFromInfo(bufferInfo: twgl.BufferInfo) {
  const attrib = bufferInfo.attribs?.a_state
  return attrib?.buffer ?? null
}

function createVectorTexture(gl: WebGL2RenderingContext, state: VectorLayerState) {
  const componentBytes = state.vectorNx * state.vectorNy
  if (state.vectorU.length !== componentBytes || state.vectorV.length !== componentBytes) {
    console.warn('[vector] unexpected vector component sizes')
    return null
  }

  const rgba = new Uint8Array(componentBytes * 4)
  for (let i = 0; i < componentBytes; i += 1) {
    const base = i * 4
    rgba[base] = i8ToU8(state.vectorU[i])
    rgba[base + 1] = i8ToU8(state.vectorV[i])
    rgba[base + 2] = 128
    rgba[base + 3] = 255
  }

  try {
    return twgl.createTexture(gl, {
      src: rgba,
      width: state.vectorNx,
      height: state.vectorNy,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrapS: gl.REPEAT,
      wrapT: gl.CLAMP_TO_EDGE,
      unpackAlignment: 1,
      auto: false,
    })
  } catch (error) {
    console.warn('[vector] failed to create vector texture:', error)
    return null
  }
}

function createProgramInfo(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  errorLabel: string,
  options?: Parameters<typeof twgl.createProgramInfo>[2],
) {
  try {
    return twgl.createProgramInfo(gl, [vertexSource, fragmentSource], {
      ...(options ?? {}),
      attribLocations: { a_state: 0 },
      errorCallback: (msg: string) => console.warn(`[vector] ${errorLabel} program error:`, msg),
    })
  } catch (error) {
    console.warn(`[vector] failed to create ${errorLabel} program:`, error)
    return null
  }
}

function computeViewportState(map: MapLibreMap): ViewportState {
  const bounds = map.getBounds()
  const south = clamp(bounds.getSouth(), -85.0, 85.0)
  const north = clamp(bounds.getNorth(), -85.0, 85.0)
  const west = bounds.getWest()
  let east = bounds.getEast()
  if (east < west) east += 360

  const mercatorWestX = lonToMercatorX(west)
  const mercatorEastX = lonToMercatorX(east)
  const mercatorNorthY = latToMercatorY(north)
  const mercatorSouthY = latToMercatorY(south)

  return {
    west,
    east,
    south,
    north,
    mercatorWestX,
    mercatorEastX,
    mercatorNorthY,
    mercatorSouthY,
  }
}

function lonToMercatorX(lon: number) {
  return (lon + 180) / 360
}

function latToMercatorY(lat: number) {
  const clamped = clamp(lat, -85.05112878, 85.05112878)
  const s = Math.sin((clamped * Math.PI) / 180)
  return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI
}

function i8ToU8(value: number) {
  return value < 0 ? value + 256 : value
}

function toCellCenterOrigin(lon0: number, lat0: number, dx: number, dy: number) {
  return {
    lon0: needsHalfCellShift(lon0, dx) ? lon0 + 0.5 * dx : lon0,
    lat0: needsHalfCellShift(lat0, dy) ? lat0 + 0.5 * dy : lat0,
  }
}

function needsHalfCellShift(origin: number, step: number) {
  if (!Number.isFinite(origin) || !Number.isFinite(step) || step === 0) return false
  const normalized = origin / step
  const fractional = Math.abs(normalized - Math.round(normalized))
  return Math.abs(fractional - 0.5) < 1e-6
}

function isReady(state: VectorLayerState) {
  return Boolean(
    state.map &&
        state.gl &&
        state.viewport &&
        state.hasFrame &&
        state.vectorTexture &&
      state.updateProgramInfo &&
      state.particleProgramInfo &&
      state.transformFeedback &&
      state.stateBufferInfos[0] &&
      state.stateBufferInfos[1],
  )
}
