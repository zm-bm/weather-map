import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'
import * as twgl from 'twgl.js'

import {
  asWebGL2,
  clamp,
} from '../../shared/webgl'
import {
  registerVectorController,
  unregisterVectorController,
  type VectorController,
} from '../controller'
import type { VectorFrameData } from './types'
import {
  VECTOR_TRAIL_FRAGMENT_SHADER_SOURCE,
  VECTOR_TRAIL_VERTEX_SHADER_SOURCE,
  VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
  VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
  VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE,
  VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
} from './shaders'
import {
  EARTH_DEG_PER_METER,
} from './constants'
import { DEFAULT_VECTOR_RUNTIME_OPTIONS, type VectorRuntimeOptions } from '../options'

type ViewportState = {
  west: number
  east: number
  south: number
  north: number
  // Cached mercator bounds for lon/lat -> clip-space conversion.
  mercatorWestX: number
  mercatorEastX: number
  mercatorNorthY: number
  mercatorSouthY: number
}

type CameraState = {
  centerLng: number
  centerLat: number
  zoom: number
  bearing: number
  pitch: number
  width: number
  height: number
}

type VectorLayerState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  enabled: boolean
  lastFrameMs: number
  particleCount: number
  // Camera bounds for culling and screen-space conversion.
  viewport: ViewportState | null
  // Signed int8 vector components from frame payload.
  vectorU: Int8Array
  vectorV: Int8Array
  // Grid shape for U/V arrays.
  vectorNx: number
  vectorNy: number
  // Grid georeferencing for shader sampling.
  vectorLon0: number
  vectorLat0: number
  vectorDx: number
  vectorDy: number
  // Packed RGBA texture built from vectorU/vectorV.
  vectorTexture: WebGLTexture | null
  available: boolean
  hasFrame: boolean
  // Compiled programs for update/draw passes.
  updateProgramInfo: twgl.ProgramInfo | null
  particleProgramInfo: twgl.ProgramInfo | null
  trailProgramInfo: twgl.ProgramInfo | null
  // Ping-pong particle-state buffers.
  stateBufferInfos: [twgl.BufferInfo | null, twgl.BufferInfo | null]
  // Active ping-pong source buffer index.
  activeSourceIndex: 0 | 1
  // Transform feedback object for next-state writes.
  transformFeedback: WebGLTransformFeedback | null
  // Fullscreen quad for trail fade/composite passes.
  trailQuadBufferInfo: twgl.BufferInfo | null
  // Ping-pong textures storing accumulated trail history.
  trailTextures: [WebGLTexture | null, WebGLTexture | null]
  // Source trail texture index from previous frame.
  activeTrailSourceIndex: 0 | 1
  trailFramebuffer: WebGLFramebuffer | null
  trailWidth: number
  trailHeight: number
  previousCameraState: CameraState | null
  pendingForcedRespawnFrac: number
  zoomGestureActive: boolean
  zoomGestureStart: number
  zoomGestureMin: number
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
    enabled: true,
    lastFrameMs: 0,
    particleCount: options.particleCount,
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
    trailProgramInfo: null,
    stateBufferInfos: [null, null],
    activeSourceIndex: 0,
    transformFeedback: null,
    trailQuadBufferInfo: null,
    trailTextures: [null, null],
    activeTrailSourceIndex: 0,
    trailFramebuffer: null,
    trailWidth: 0,
    trailHeight: 0,
    previousCameraState: null,
    pendingForcedRespawnFrac: 0,
    zoomGestureActive: false,
    zoomGestureStart: 0,
    zoomGestureMin: 0,
  }
  const controller: VectorController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Vector runtime unavailable (WebGL2 required)')
      // Upload the latest vector field and optionally reseed particles.
      applyVectorFieldToState(state, frame, options)
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      state.enabled = enabled
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerVectorController(map, controller)

      // Transform feedback is required for GPU-side particle updates.
      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) {
        state.available = false
        console.warn('[vector] WebGL2 is required for GPU particle simulation')
        return
      }

      state.gl = gl2
      state.lastFrameMs = performance.now()
      state.viewport = computeViewportState(map)

      // Update program writes next state into the transform feedback buffer.
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

      // Particle program renders current state as oriented dashes.
      state.particleProgramInfo = createProgramInfo(
        gl2,
        VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
        VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
        'particle',
      )

      // Trail program fades/composites full-screen trail textures.
      state.trailProgramInfo = createProgramInfo(
        gl2,
        VECTOR_TRAIL_VERTEX_SHADER_SOURCE,
        VECTOR_TRAIL_FRAGMENT_SHADER_SOURCE,
        'trail',
        {
          attribLocations: { a_pos: 0 },
        },
      )

      if (!state.updateProgramInfo || !state.particleProgramInfo || !state.trailProgramInfo) {
        state.available = false
        return
      }

      // Allocate ping-pong state buffers with seeded particles.
      const initial = buildInitialParticleState(
        state.particleCount,
        state.viewport,
        options.maxAgeSec,
      )
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

      state.trailQuadBufferInfo = createTrailQuadBufferInfo(gl2)
      if (!state.trailQuadBufferInfo) {
        state.available = false
        return
      }

      state.trailFramebuffer = gl2.createFramebuffer()
      if (!state.trailFramebuffer) {
        state.available = false
        return
      }

      if (!ensureTrailTargets(state, options)) {
        state.available = false
        return
      }
      state.previousCameraState = captureCameraState(state)
      state.available = true

      // Keep the custom layer animating.
      map.triggerRepaint()
    },

    render(gl) {
      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) return
      if (!state.enabled || !state.available || !state.hasFrame) return
      if (!isReady(state)) return
      if (!state.map) return

      // Refresh camera bounds every frame as pan/zoom changes.
      state.viewport = computeViewportState(state.map)
      updateZoomOutRespawnState(state, options)

      const now = performance.now()
      // Clamp delta time to keep integration stable on slow frames.
      const dtSec = clamp((now - state.lastFrameMs) / 1000, 0.001, 0.05)
      state.lastFrameMs = now

      if (!ensureTrailTargets(state, options)) return

      const cameraChanged = didCameraChange(state)
      if (options.clearTrailsOnViewChange && cameraChanged) {
        clearTrailTextures(state)
      }

      // Run simulation first, then draw.
      runUpdatePass(state, dtSec, now, options)
      const trailTexture = runTrailPass(state, options)
      if (trailTexture) {
        compositeTrailToMap(state, trailTexture, options)
      } else {
        runParticlePass(state, options)
      }

      state.map.triggerRepaint()
    },

    onRemove(map, gl) {
      unregisterVectorController(map)
      void gl
      const gl2 = state.gl

      if (gl2) {
        // Release GPU resources owned by this runtime.
        if (state.vectorTexture) gl2.deleteTexture(state.vectorTexture)
        if (state.updateProgramInfo) gl2.deleteProgram(state.updateProgramInfo.program)
        if (state.particleProgramInfo) gl2.deleteProgram(state.particleProgramInfo.program)
        if (state.trailProgramInfo) gl2.deleteProgram(state.trailProgramInfo.program)
        if (state.stateBufferInfos[0]) {
          const buffer = getStateBufferFromInfo(state.stateBufferInfos[0])
          if (buffer) gl2.deleteBuffer(buffer)
        }
        if (state.stateBufferInfos[1]) {
          const buffer = getStateBufferFromInfo(state.stateBufferInfos[1])
          if (buffer) gl2.deleteBuffer(buffer)
        }
        if (state.trailQuadBufferInfo) {
          const buffer = getTrailQuadBufferFromInfo(state.trailQuadBufferInfo)
          if (buffer) gl2.deleteBuffer(buffer)
        }
        if (state.trailTextures[0]) gl2.deleteTexture(state.trailTextures[0])
        if (state.trailTextures[1]) gl2.deleteTexture(state.trailTextures[1])
        if (state.trailFramebuffer) gl2.deleteFramebuffer(state.trailFramebuffer)
        if (state.transformFeedback) gl2.deleteTransformFeedback(state.transformFeedback)
      }

      state.map = undefined
      state.gl = undefined
      state.enabled = true
      state.viewport = null
      state.vectorTexture = null
      state.available = false
      state.hasFrame = false
      state.updateProgramInfo = null
      state.particleProgramInfo = null
      state.trailProgramInfo = null
      state.stateBufferInfos = [null, null]
      state.transformFeedback = null
      state.trailQuadBufferInfo = null
      state.trailTextures = [null, null]
      state.activeTrailSourceIndex = 0
      state.trailFramebuffer = null
      state.trailWidth = 0
      state.trailHeight = 0
      state.previousCameraState = null
      state.pendingForcedRespawnFrac = 0
      state.zoomGestureActive = false
      state.zoomGestureStart = 0
      state.zoomGestureMin = 0
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

  // Normalize metadata origin so sampling lines up with cell centers.
  const samplingOrigin = toCellCenterOrigin(
    vectorField.metadata.lon0,
    vectorField.metadata.lat0,
    vectorField.metadata.dx,
    vectorField.metadata.dy,
  )

  // Store raw components and grid metadata for texture upload/uniforms.
  state.vectorU = vectorField.u
  state.vectorV = vectorField.v
  state.vectorNx = vectorField.metadata.nx
  state.vectorNy = vectorField.metadata.ny
  state.vectorLon0 = samplingOrigin.lon0
  state.vectorLat0 = samplingOrigin.lat0
  state.vectorDx = vectorField.metadata.dx
  state.vectorDy = vectorField.metadata.dy

  // Rebuild packed vector texture for the latest frame.
  const nextTexture = createVectorTexture(gl, state)
  if (!nextTexture) {
    console.warn('[vector] failed to upload live vector texture; keeping previous texture')
    return
  }

  if (state.vectorTexture) gl.deleteTexture(state.vectorTexture)
  state.vectorTexture = nextTexture
  state.hasFrame = true
  if (options.reseedOnFrameChange) {
    // Optional continuity break on frame change.
    reseedParticles(state, options.maxAgeSec)
    state.activeSourceIndex = 0
    state.activeTrailSourceIndex = 0
    clearTrailTextures(state)
  }
  state.lastFrameMs = performance.now()
}

function runUpdatePass(
  state: VectorLayerState,
  dtSec: number,
  nowMs: number,
  options: VectorRuntimeOptions,
) {
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

  // Write transform feedback into the opposite ping-pong buffer.
  const dstBuffer = getStateBufferFromInfo(dstBufferInfo)
  if (!dstBuffer) return

  const zoom = map?.getZoom() ?? options.flowRefZoom
  const forcedRespawnFrac = clamp(state.pendingForcedRespawnFrac, 0, 1)
  gl.useProgram(updateProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, updateProgramInfo, srcBufferInfo)
  // Simulation uniforms: field sampling, advection, age, and viewport bounds.
  twgl.setUniforms(updateProgramInfo, {
    u_dt_sec: dtSec,
    u_seed: nowMs * 0.001,
    u_lon0: state.vectorLon0,
    u_lat0: state.vectorLat0,
    u_dx: state.vectorDx,
    u_dy: state.vectorDy,
    u_vector_size: [state.vectorNx, state.vectorNy],
    u_speed_multiplier: options.flowSpeedScale,
    u_zoom_scale: Math.pow(2, options.flowRefZoom - zoom),
    u_deg_per_meter: EARTH_DEG_PER_METER,
    u_max_age_sec: options.maxAgeSec,
    u_base_respawn_per_sec: options.respawnBasePerSec,
    u_speed_respawn_per_mps: options.respawnSpeedPerMps,
    u_forced_respawn_frac: forcedRespawnFrac,
    u_motion_jitter_ratio: options.jitterRatio,
    u_bounds_west: viewport.west,
    u_bounds_east: viewport.east,
    u_bounds_south: viewport.south,
    u_bounds_north: viewport.north,
    u_vector_tex: vectorTexture,
  })

  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback)
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dstBuffer)

  // GPU-only update pass with rasterization disabled.
  gl.enable(gl.RASTERIZER_DISCARD)
  gl.beginTransformFeedback(gl.POINTS)
  twgl.drawBufferInfo(gl, srcBufferInfo, gl.POINTS, particleCount)
  gl.endTransformFeedback()
  gl.disable(gl.RASTERIZER_DISCARD)

  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
  gl.useProgram(null)
  state.pendingForcedRespawnFrac = 0

  state.activeSourceIndex = activeSourceIndex === 0 ? 1 : 0
}

function runParticlePass(state: VectorLayerState, options: VectorRuntimeOptions) {
  const { gl } = state
  if (!gl) return

  // Fallback direct draw path (used if trail targets are unavailable).
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  drawParticleGeometryPass(state, options)
}

function runTrailPass(state: VectorLayerState, options: VectorRuntimeOptions) {
  const {
    gl,
    trailFramebuffer,
    trailTextures,
    activeTrailSourceIndex,
  } = state
  if (!gl || !trailFramebuffer || !trailTextures[0] || !trailTextures[1]) return null

  const srcTexture = trailTextures[activeTrailSourceIndex]
  const dstIndex: 0 | 1 = activeTrailSourceIndex === 0 ? 1 : 0
  const dstTexture = trailTextures[dstIndex]
  if (!srcTexture || !dstTexture) return null

  // Fade previous trail history into the destination texture.
  bindTrailFramebuffer(gl, trailFramebuffer, dstTexture)
  gl.viewport(0, 0, state.trailWidth, state.trailHeight)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  compositeTrailPass(state, srcTexture, options.trailFade, options.trailQuantize)

  // Draw the current particle frame on top of faded history.
  drawParticleGeometryPass(state, options)

  state.activeTrailSourceIndex = dstIndex
  return dstTexture
}

function compositeTrailPass(
  state: VectorLayerState,
  texture: WebGLTexture,
  opacity: number,
  quantize: boolean,
) {
  const { gl, trailProgramInfo, trailQuadBufferInfo } = state
  if (!gl || !trailProgramInfo || !trailQuadBufferInfo) return

  gl.useProgram(trailProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, trailProgramInfo, trailQuadBufferInfo)
  twgl.setUniforms(trailProgramInfo, {
    u_screen: texture,
    u_opacity: opacity,
    u_quantize: quantize ? 1 : 0,
  })
  twgl.drawBufferInfo(gl, trailQuadBufferInfo, gl.TRIANGLES)
  gl.useProgram(null)
}

function compositeTrailToMap(
  state: VectorLayerState,
  texture: WebGLTexture,
  options: VectorRuntimeOptions,
) {
  const { gl, trailProgramInfo, trailQuadBufferInfo } = state
  if (!gl || !trailProgramInfo || !trailQuadBufferInfo) return

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  gl.useProgram(trailProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, trailProgramInfo, trailQuadBufferInfo)
  twgl.setUniforms(trailProgramInfo, {
    u_screen: texture,
    u_opacity: clamp(options.trailCompositeOpacity, 0, 1),
    u_quantize: 0,
  })
  twgl.drawBufferInfo(gl, trailQuadBufferInfo, gl.TRIANGLES)
  gl.useProgram(null)

  gl.disable(gl.BLEND)
}

function drawParticleGeometryPass(state: VectorLayerState, options: VectorRuntimeOptions) {
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

  gl.useProgram(particleProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, particleProgramInfo, particleBufferInfo)

  const zoom = map.getZoom()
  // Render uniforms: viewport mapping, dash styling, and local flow direction.
  const commonUniforms = {
    u_bounds_west: viewport.west,
    u_bounds_east: viewport.east,
    u_mercator_bounds: [
      viewport.mercatorWestX,
      viewport.mercatorEastX,
      viewport.mercatorNorthY,
      viewport.mercatorSouthY,
    ],
    u_point_size: options.pointSizePx,
    u_lon0: state.vectorLon0,
    u_lat0: state.vectorLat0,
    u_dx: state.vectorDx,
    u_dy: state.vectorDy,
    u_vector_size: [state.vectorNx, state.vectorNy],
    u_deg_per_meter: EARTH_DEG_PER_METER,
    u_dir_step_sec: options.dirSampleStepSec,
    u_speed_multiplier: options.flowSpeedScale,
    u_zoom_scale: Math.pow(2, options.flowRefZoom - zoom),
    u_dash_min_len_px: options.dashMinPx,
    u_dash_max_len_px: options.dashMaxPx,
    u_dash_len_per_mps: options.dashPerMps,
    u_speed_ramp_gamma: options.speedRampGamma,
    u_vector_tex: vectorTexture,
  }
  twgl.setUniforms(particleProgramInfo, commonUniforms)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  // Pass 1: darker/wider understroke.
  twgl.setUniforms(particleProgramInfo, {
    u_color_slow: options.shadowSlow,
    u_color_fast: options.shadowFast,
    u_dash_width_px: options.shadowWidthPx,
  })
  twgl.drawBufferInfo(gl, particleBufferInfo, gl.POINTS, particleCount)

  // Pass 2: lighter/narrower core.
  twgl.setUniforms(particleProgramInfo, {
    u_color_slow: options.coreSlow,
    u_color_fast: options.coreFast,
    u_dash_width_px: options.coreWidthPx,
  })
  twgl.drawBufferInfo(gl, particleBufferInfo, gl.POINTS, particleCount)

  gl.disable(gl.BLEND)
  gl.useProgram(null)
}

function createTrailQuadBufferInfo(gl: WebGL2RenderingContext) {
  return twgl.createBufferInfoFromArrays(gl, {
    a_pos: {
      numComponents: 2,
      data: new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        0, 1,
        1, 0,
        1, 1,
      ]),
    },
  })
}

function getTrailQuadBufferFromInfo(bufferInfo: twgl.BufferInfo) {
  const attrib = bufferInfo.attribs?.a_pos
  return attrib?.buffer ?? null
}

function ensureTrailTargets(state: VectorLayerState, options: VectorRuntimeOptions) {
  const { gl, trailFramebuffer, trailTextures } = state
  if (!gl || !trailFramebuffer) return false

  const scale = clamp(
    Number.isFinite(options.trailScale) ? options.trailScale : 1,
    0.1,
    1,
  )
  const width = Math.max(1, Math.floor(gl.drawingBufferWidth * scale))
  const height = Math.max(1, Math.floor(gl.drawingBufferHeight * scale))

  const sizeUnchanged = width === state.trailWidth && height === state.trailHeight
  if (sizeUnchanged && trailTextures[0] && trailTextures[1]) {
    return true
  }

  if (trailTextures[0]) gl.deleteTexture(trailTextures[0])
  if (trailTextures[1]) gl.deleteTexture(trailTextures[1])

  const next0 = createTrailTexture(gl, width, height)
  const next1 = createTrailTexture(gl, width, height)
  if (!next0 || !next1) {
    state.trailTextures = [null, null]
    state.trailWidth = 0
    state.trailHeight = 0
    return false
  }

  state.trailTextures = [next0, next1]
  state.trailWidth = width
  state.trailHeight = height
  state.activeTrailSourceIndex = 0
  clearTrailTextures(state)
  return true
}

function createTrailTexture(gl: WebGL2RenderingContext, width: number, height: number) {
  try {
    return twgl.createTexture(gl, {
      src: new Uint8Array(width * height * 4),
      width,
      height,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      unpackAlignment: 1,
      auto: false,
    })
  } catch (error) {
    console.warn('[vector] failed to create trail texture:', error)
    return null
  }
}

function bindTrailFramebuffer(
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  texture: WebGLTexture,
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
}

function clearTrailTextures(state: VectorLayerState) {
  const { gl, trailFramebuffer, trailTextures, trailWidth, trailHeight } = state
  if (!gl || !trailFramebuffer || !trailTextures[0] || !trailTextures[1]) return

  const clearColor = new Float32Array([0, 0, 0, 0])
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)
  gl.viewport(0, 0, trailWidth, trailHeight)
  bindTrailFramebuffer(gl, trailFramebuffer, trailTextures[0])
  gl.clearBufferfv(gl.COLOR, 0, clearColor)
  bindTrailFramebuffer(gl, trailFramebuffer, trailTextures[1])
  gl.clearBufferfv(gl.COLOR, 0, clearColor)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
}

function didCameraChange(state: VectorLayerState) {
  const next = captureCameraState(state)
  if (!next) return false
  const prev = state.previousCameraState
  state.previousCameraState = next
  if (!prev) return false
  return hasCameraChanged(prev, next)
}

function updateZoomOutRespawnState(state: VectorLayerState, options: VectorRuntimeOptions) {
  const map = state.map
  if (!map) return

  const zoom = map.getZoom()
  if (map.isZooming()) {
    if (!state.zoomGestureActive) {
      state.zoomGestureActive = true
      state.zoomGestureStart = zoom
      state.zoomGestureMin = zoom
      return
    }
    state.zoomGestureMin = Math.min(state.zoomGestureMin, zoom)
    return
  }

  if (!state.zoomGestureActive) return
  state.zoomGestureActive = false

  const zoomOutDelta = state.zoomGestureStart - state.zoomGestureMin
  if (zoomOutDelta >= options.zoomOutRespawnMinDelta) {
    state.pendingForcedRespawnFrac = Math.max(
      state.pendingForcedRespawnFrac,
      clamp(options.zoomOutRespawnFraction, 0, 1),
    )
  }
}

function captureCameraState(state: VectorLayerState): CameraState | null {
  const { map, gl } = state
  if (!map || !gl) return null
  const center = map.getCenter()
  return {
    centerLng: center.lng,
    centerLat: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
  }
}

function hasCameraChanged(previous: CameraState, next: CameraState) {
  return (
    !roughlyEqual(previous.centerLng, next.centerLng, 1e-7) ||
    !roughlyEqual(previous.centerLat, next.centerLat, 1e-7) ||
    !roughlyEqual(previous.zoom, next.zoom, 1e-7) ||
    !roughlyEqual(previous.bearing, next.bearing, 1e-7) ||
    !roughlyEqual(previous.pitch, next.pitch, 1e-7) ||
    previous.width !== next.width ||
    previous.height !== next.height
  )
}

function roughlyEqual(a: number, b: number, epsilon: number) {
  return Math.abs(a - b) <= epsilon
}

function reseedParticles(state: VectorLayerState, maxAgeSec: number) {
  const { gl, viewport, stateBufferInfos, particleCount } = state
  if (!gl || !viewport || !stateBufferInfos[0] || !stateBufferInfos[1]) return

  const stateBuffer0 = getStateBufferFromInfo(stateBufferInfos[0])
  const stateBuffer1 = getStateBufferFromInfo(stateBufferInfos[1])
  if (!stateBuffer0 || !stateBuffer1) return

  // Reset both ping-pong buffers to the same seed state.
  const seeded = buildInitialParticleState(particleCount, viewport, maxAgeSec)
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer0)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer1)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

function buildInitialParticleState(
  count: number,
  viewport: ViewportState | null,
  maxAgeSec: number,
): Float32Array {
  const out = new Float32Array(count * 3)
  if (!viewport) return out

  // a_state layout: [lon, lat, ageSec].
  for (let i = 0; i < count; i += 1) {
    const base = i * 3
    const lon = viewport.west + Math.random() * (viewport.east - viewport.west)
    const lat = viewport.south + Math.random() * (viewport.north - viewport.south)
    out[base] = lon > 180 ? lon - 360 : lon
    out[base + 1] = lat
    out[base + 2] = Math.random() * maxAgeSec
  }
  return out
}

function createStateBufferInfo(gl: WebGL2RenderingContext, data: Float32Array) {
  // Shared vec3 attribute used by update and render programs.
  return twgl.createBufferInfoFromArrays(gl, {
    a_state: {
      numComponents: 3,
      data,
      drawType: gl.DYNAMIC_DRAW,
    },
  })
}

function getStateBufferFromInfo(bufferInfo: twgl.BufferInfo) {
  // TWGL wraps attrib buffers; this unwraps the raw buffer for TF binding.
  const attrib = bufferInfo.attribs?.a_state
  return attrib?.buffer ?? null
}

function createVectorTexture(gl: WebGL2RenderingContext, state: VectorLayerState) {
  const componentBytes = state.vectorNx * state.vectorNy
  if (state.vectorU.length !== componentBytes || state.vectorV.length !== componentBytes) {
    console.warn('[vector] unexpected vector component sizes')
    return null
  }

  // Pack signed U/V into RG channels of an RGBA8 texture.
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
  options?: twgl.ProgramOptions,
) {
  try {
    // Keep attribute locations stable for each program family.
    const attribLocations = options?.attribLocations ?? { a_state: 0 }
    return twgl.createProgramInfo(gl, [vertexSource, fragmentSource], {
      ...(options ?? {}),
      attribLocations,
      errorCallback: (msg: string) => console.warn(`[vector] ${errorLabel} program error:`, msg),
    })
  } catch (error) {
    console.warn(`[vector] failed to create ${errorLabel} program:`, error)
    return null
  }
}

function computeViewportState(map: MapLibreMap): ViewportState {
  const bounds = map.getBounds()
  // Clamp latitude to the WebMercator domain.
  const south = clamp(bounds.getSouth(), -85.0, 85.0)
  const north = clamp(bounds.getNorth(), -85.0, 85.0)
  const west = bounds.getWest()
  let east = bounds.getEast()
  // Unwrap antimeridian crossings into a continuous east-west span.
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
  // Accept unwrapped longitudes (can exceed 180 when crossing the dateline).
  return (lon + 180) / 360
}

function latToMercatorY(lat: number) {
  // Standard WebMercator Y in [0, 1].
  const clamped = clamp(lat, -85.05112878, 85.05112878)
  const s = Math.sin((clamped * Math.PI) / 180)
  return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI
}

function i8ToU8(value: number) {
  // Reinterpret i8 payload from normalized unsigned texture bytes.
  return value < 0 ? value + 256 : value
}

function toCellCenterOrigin(lon0: number, lat0: number, dx: number, dy: number) {
  // Detect cell-edge origins and shift to cell centers when needed.
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
  // Render/update requires all GPU resources plus a loaded frame.
  return Boolean(
    state.map &&
      state.gl &&
      state.viewport &&
      state.hasFrame &&
      state.vectorTexture &&
      state.updateProgramInfo &&
      state.particleProgramInfo &&
      state.trailProgramInfo &&
      state.transformFeedback &&
      state.trailQuadBufferInfo &&
      state.trailFramebuffer &&
      state.stateBufferInfos[0] &&
      state.stateBufferInfos[1],
  )
}
