import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'
import * as twgl from 'twgl.js'

import {
  asWebGL2,
} from '../../webgl'
import { clamp } from '@/core/math'
import {
  registerParticleController,
  unregisterParticleController,
  type ParticleController,
} from '../controller'
import {
  type WindVectorTimeSliceData,
  type WindVectorInterpolationWindowData,
} from '@/forecast/data'
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
import {
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  type ParticleRenderSettings,
} from '@/forecast/settings/settings'
import {
  captureCameraState,
  computeViewportState,
  expandViewportBounds,
  hasCameraChanged,
  toCellCenterOrigin,
  type CameraState,
  type ViewportBounds,
  type ViewportState,
} from './geo'

type ParticleState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  enabled: boolean
  lastFrameMs: number
  particleCount: number
  // Camera bounds for culling and screen-space conversion.
  viewport: ViewportState | null
  // Grid shape for U/V arrays.
  vectorNx: number
  vectorNy: number
  // Grid georeferencing for shader sampling.
  vectorLon0: number
  vectorLat0: number
  vectorDx: number
  vectorDy: number
  // Packed RGBA textures built from lower/upper vector frames.
  vectorTextureLower: WebGLTexture | null
  vectorTextureUpper: WebGLTexture | null
  vectorFrameLower: WindVectorTimeSliceData | null
  vectorFrameUpper: WindVectorTimeSliceData | null
  timeMix: number
  frameSignature: string | null
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

export type ParticleRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    _input: CustomRenderMethodInput
  ) => void
  onRemove: (_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createParticleRuntime(
  initialSettings: Partial<ParticleRenderSettings> = DEFAULT_PARTICLE_RENDER_SETTINGS
): ParticleRuntime {
  const settings: ParticleRenderSettings = {
    ...DEFAULT_PARTICLE_RENDER_SETTINGS,
    ...initialSettings,
  }
  const state: ParticleState = {
    enabled: true,
    lastFrameMs: 0,
    particleCount: settings.particleCount,
    viewport: null,
    vectorNx: 0,
    vectorNy: 0,
    vectorLon0: 0,
    vectorLat0: 0,
    vectorDx: 1,
    vectorDy: -1,
    vectorTextureLower: null,
    vectorTextureUpper: null,
    vectorFrameLower: null,
    vectorFrameUpper: null,
    timeMix: 0,
    frameSignature: null,
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
  const controller: ParticleController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Vector runtime unavailable (WebGL2 required)')
      // Upload the latest vector field and optionally reseed particles.
      applyVectorFieldToState(state, frame, settings)
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      state.enabled = enabled
      state.map?.triggerRepaint()
    },
    applySettings: (nextSettings) => {
      applyParticleRenderSettingsToState(state, settings, nextSettings)
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerParticleController(map, controller)

      // Transform feedback is required for GPU-side particle updates.
      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) {
        state.available = false
        console.warn('[particles] WebGL2 is required for GPU particle simulation')
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

      // Particle program renders current state as speed-scaled dots.
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
        expandViewportBounds(state.viewport, settings.simulationViewportPaddingRatio),
        settings.maxAgeSec,
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

      if (!ensureTrailTargets(state, settings)) {
        state.available = false
        return
      }
      state.previousCameraState = captureCameraState(state.map, state.gl)
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
      updateZoomOutRespawnState(state, settings)

      const now = performance.now()
      // Clamp delta time to keep integration stable on slow frames.
      const dtSec = clamp((now - state.lastFrameMs) / 1000, 0.001, 0.05)
      state.lastFrameMs = now

      if (!ensureTrailTargets(state, settings)) return

      const cameraChanged = didCameraChange(state)
      if (settings.clearTrailsOnViewChange && cameraChanged) {
        clearTrailTextures(state)
      }

      // Run simulation first, then draw.
      runUpdatePass(state, dtSec, now, settings)
      const trailTexture = runTrailPass(state, settings)
      if (trailTexture) {
        compositeTrailToMap(state, trailTexture, settings)
      } else {
        runParticlePass(state, settings)
      }

      state.map.triggerRepaint()
    },

    onRemove(map, gl) {
      unregisterParticleController(map)
      void gl
      const gl2 = state.gl

      if (gl2) {
        // Release GPU resources owned by this runtime.
        deleteUnusedVectorTexture(gl2, state.vectorTextureLower, null, state.vectorTextureUpper)
        if (state.vectorTextureUpper) gl2.deleteTexture(state.vectorTextureUpper)
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
      state.vectorTextureLower = null
      state.vectorTextureUpper = null
      state.vectorFrameLower = null
      state.vectorFrameUpper = null
      state.timeMix = 0
      state.frameSignature = null
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
  state: ParticleState,
  vectorField: WindVectorInterpolationWindowData,
  options: ParticleRenderSettings,
) {
  const gl = state.gl
  if (!gl) return
  const lowerFrame = vectorField.lower
  const canBlend = vectorField.mix > 0
  const upperFrame = canBlend ? vectorField.upper : vectorField.lower

  // Normalize metadata origin so sampling lines up with cell centers.
  const samplingOrigin = toCellCenterOrigin(
    lowerFrame.grid.lon0,
    lowerFrame.grid.lat0,
    lowerFrame.grid.dx,
    lowerFrame.grid.dy,
  )

  state.vectorNx = lowerFrame.grid.nx
  state.vectorNy = lowerFrame.grid.ny
  state.vectorLon0 = samplingOrigin.lon0
  state.vectorLat0 = samplingOrigin.lat0
  state.vectorDx = lowerFrame.grid.dx
  state.vectorDy = lowerFrame.grid.dy
  state.timeMix = canBlend ? vectorField.mix : 0

  const previousTextureLower = state.vectorTextureLower
  const previousTextureUpper = state.vectorTextureUpper
  const reusableTextureLower = findReusableVectorTexture(state, lowerFrame)
  const reusableTextureUpper = upperFrame === lowerFrame
    ? reusableTextureLower
    : findReusableVectorTexture(state, upperFrame)
  const createdTextureLower = reusableTextureLower ? null : createVectorTexture(gl, lowerFrame)
  const nextTextureLower = reusableTextureLower ?? createdTextureLower
  if (!nextTextureLower) {
    console.warn('[particles] failed to upload live vector texture; keeping previous texture')
    return
  }
  const createdTextureUpper = upperFrame === lowerFrame || reusableTextureUpper
    ? null
    : createVectorTexture(gl, upperFrame)
  const nextTextureUpper = upperFrame === lowerFrame
    ? nextTextureLower
    : reusableTextureUpper ?? createdTextureUpper
  if (!nextTextureUpper) {
    if (createdTextureLower) gl.deleteTexture(createdTextureLower)
    console.warn('[particles] failed to upload live vector texture; keeping previous texture')
    return
  }

  deleteUnusedVectorTexture(gl, previousTextureLower, nextTextureLower, nextTextureUpper)
  deleteUnusedVectorTexture(gl, previousTextureUpper, nextTextureLower, nextTextureUpper)
  state.vectorTextureLower = nextTextureLower
  state.vectorTextureUpper = nextTextureUpper
  state.vectorFrameLower = lowerFrame
  state.vectorFrameUpper = upperFrame
  state.hasFrame = true
  const nextFrameSignature = [
    lowerFrame.artifactId,
    lowerFrame.hourToken,
    upperFrame.hourToken,
  ].join(':')
  const didFramePairChange = state.frameSignature !== nextFrameSignature
  state.frameSignature = nextFrameSignature
  if (options.reseedOnFrameChange && didFramePairChange) {
    // Optional continuity break on frame change.
    reseedParticles(state, options)
    state.activeSourceIndex = 0
    state.activeTrailSourceIndex = 0
    clearTrailTextures(state)
  }
  state.lastFrameMs = performance.now()
}

function applyParticleRenderSettingsToState(
  state: ParticleState,
  options: ParticleRenderSettings,
  nextOptions: Partial<ParticleRenderSettings>,
) {
  const previousParticleCount = options.particleCount
  const nextParticleCount = nextOptions.particleCount == null
    ? options.particleCount
    : sanitizeParticleCount(nextOptions.particleCount)

  Object.assign(options, nextOptions)
  options.particleCount = nextParticleCount

  if (previousParticleCount !== nextParticleCount) {
    if (!state.gl) {
      state.particleCount = nextParticleCount
    } else if (rebuildParticleStateBuffers(state, options, nextParticleCount)) {
      state.particleCount = nextParticleCount
    } else {
      options.particleCount = previousParticleCount
    }
  }

  state.map?.triggerRepaint()
}

function sanitizeParticleCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PARTICLE_RENDER_SETTINGS.particleCount
  return Math.max(0, Math.floor(value))
}

function rebuildParticleStateBuffers(
  state: ParticleState,
  options: ParticleRenderSettings,
  particleCount: number,
): boolean {
  const { gl } = state
  if (!gl) return false

  const initial = buildInitialParticleState(
    particleCount,
    expandViewportBounds(state.viewport, options.simulationViewportPaddingRatio),
    options.maxAgeSec,
  )
  const nextBuffer0 = createStateBufferInfo(gl, initial)
  const nextBuffer1 = createStateBufferInfo(gl, initial)
  if (!nextBuffer0 || !nextBuffer1) {
    const buffer0 = nextBuffer0 ? getStateBufferFromInfo(nextBuffer0) : null
    const buffer1 = nextBuffer1 ? getStateBufferFromInfo(nextBuffer1) : null
    if (buffer0) gl.deleteBuffer(buffer0)
    if (buffer1) gl.deleteBuffer(buffer1)
    console.warn('[particles] failed to resize particle state buffers; keeping previous buffers')
    return false
  }

  const previousBuffer0 = state.stateBufferInfos[0]
    ? getStateBufferFromInfo(state.stateBufferInfos[0])
    : null
  const previousBuffer1 = state.stateBufferInfos[1]
    ? getStateBufferFromInfo(state.stateBufferInfos[1])
    : null
  if (previousBuffer0) gl.deleteBuffer(previousBuffer0)
  if (previousBuffer1) gl.deleteBuffer(previousBuffer1)

  state.stateBufferInfos = [nextBuffer0, nextBuffer1]
  state.activeSourceIndex = 0
  clearTrailTextures(state)
  return true
}

function findReusableVectorTexture(
  state: ParticleState,
  frame: WindVectorTimeSliceData
): WebGLTexture | null {
  if (state.vectorFrameLower === frame) return state.vectorTextureLower
  if (state.vectorFrameUpper === frame) return state.vectorTextureUpper
  return null
}

function deleteUnusedVectorTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
  nextLowerTexture: WebGLTexture | null,
  nextUpperTexture: WebGLTexture | null
) {
  if (!texture) return
  if (texture === nextLowerTexture || texture === nextUpperTexture) return
  gl.deleteTexture(texture)
}

function runUpdatePass(
  state: ParticleState,
  dtSec: number,
  nowMs: number,
  options: ParticleRenderSettings,
) {
  const {
    gl,
    updateProgramInfo,
    vectorTextureLower,
    vectorTextureUpper,
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
    !vectorTextureLower ||
    !vectorTextureUpper ||
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
  const simulationBounds = expandViewportBounds(viewport, options.simulationViewportPaddingRatio)
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
    u_time_mix: state.timeMix,
    u_speed_multiplier: options.flowSpeedScale,
    u_zoom_scale: Math.pow(2, options.flowRefZoom - zoom),
    u_deg_per_meter: EARTH_DEG_PER_METER,
    u_max_age_sec: options.maxAgeSec,
    u_base_respawn_per_sec: options.respawnBasePerSec,
    u_speed_respawn_per_mps: options.respawnSpeedPerMps,
    u_stagnation_respawn_start_mps: options.stagnationRespawnStartMps,
    u_stagnation_respawn_end_mps: options.stagnationRespawnEndMps,
    u_stagnation_respawn_per_sec: options.stagnationRespawnPerSec,
    u_forced_respawn_frac: forcedRespawnFrac,
    u_motion_jitter_ratio: options.jitterRatio,
    u_motion_speed_floor_mps: options.motionSpeedFloorMps,
    u_bounds_west: simulationBounds?.west ?? viewport.west,
    u_bounds_east: simulationBounds?.east ?? viewport.east,
    u_bounds_south: simulationBounds?.south ?? viewport.south,
    u_bounds_north: simulationBounds?.north ?? viewport.north,
    u_vector_tex_lower: vectorTextureLower,
    u_vector_tex_upper: vectorTextureUpper,
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

function runParticlePass(state: ParticleState, options: ParticleRenderSettings) {
  const { gl } = state
  if (!gl) return

  // Fallback direct draw path (used if trail targets are unavailable).
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  drawParticleGeometryPass(state, options)
}

function runTrailPass(state: ParticleState, options: ParticleRenderSettings) {
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
  state: ParticleState,
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
  state: ParticleState,
  texture: WebGLTexture,
  options: ParticleRenderSettings,
) {
  const { gl, trailProgramInfo, trailQuadBufferInfo } = state
  if (!gl || !trailProgramInfo || !trailQuadBufferInfo) return

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  )

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

function drawParticleGeometryPass(state: ParticleState, options: ParticleRenderSettings) {
  const {
    gl,
    viewport,
    vectorTextureLower,
    vectorTextureUpper,
    particleProgramInfo,
    stateBufferInfos,
    activeSourceIndex,
    particleCount,
  } = state
  if (
    !gl ||
    !viewport ||
    !vectorTextureLower ||
    !vectorTextureUpper ||
    !particleProgramInfo ||
    !stateBufferInfos[activeSourceIndex]
  ) {
    return
  }

  const particleBufferInfo = stateBufferInfos[activeSourceIndex]
  if (!particleBufferInfo) return

  gl.useProgram(particleProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, particleProgramInfo, particleBufferInfo)

  // Render uniforms: viewport mapping, dot styling, and local flow speed.
  const commonUniforms = {
    u_bounds_west: viewport.west,
    u_bounds_east: viewport.east,
    u_mercator_bounds: [
      viewport.mercatorWestX,
      viewport.mercatorEastX,
      viewport.mercatorNorthY,
      viewport.mercatorSouthY,
    ],
    u_dot_min_px: options.dotMinPx,
    u_dot_max_px: options.dotMaxPx,
    u_lon0: state.vectorLon0,
    u_lat0: state.vectorLat0,
    u_dx: state.vectorDx,
    u_dy: state.vectorDy,
    u_vector_size: [state.vectorNx, state.vectorNy],
    u_time_mix: state.timeMix,
    u_speed_ramp_gamma: options.speedRampGamma,
    u_max_age_sec: options.maxAgeSec,
    u_fade_in_age_ratio: options.fadeInAgeRatio,
    u_fade_out_age_ratio: options.fadeOutAgeRatio,
    u_stagnation_fade_start_mps: options.stagnationFadeStartMps,
    u_stagnation_fade_end_mps: options.stagnationFadeEndMps,
    u_vector_tex_lower: vectorTextureLower,
    u_vector_tex_upper: vectorTextureUpper,
  }
  twgl.setUniforms(particleProgramInfo, commonUniforms)

  gl.enable(gl.BLEND)
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  )

  twgl.setUniforms(particleProgramInfo, {
    u_core_color_slow: options.coreSlow,
    u_core_color_fast: options.coreFast,
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

function ensureTrailTargets(state: ParticleState, options: ParticleRenderSettings) {
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
    console.warn('[particles] failed to create trail texture:', error)
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

function clearTrailTextures(state: ParticleState) {
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

function didCameraChange(state: ParticleState) {
  const next = captureCameraState(state.map, state.gl)
  if (!next) return false
  const prev = state.previousCameraState
  state.previousCameraState = next
  if (!prev) return false
  return hasCameraChanged(prev, next)
}

function updateZoomOutRespawnState(state: ParticleState, options: ParticleRenderSettings) {
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

function reseedParticles(state: ParticleState, options: ParticleRenderSettings) {
  const { gl, viewport, stateBufferInfos, particleCount } = state
  if (!gl || !viewport || !stateBufferInfos[0] || !stateBufferInfos[1]) return

  const stateBuffer0 = getStateBufferFromInfo(stateBufferInfos[0])
  const stateBuffer1 = getStateBufferFromInfo(stateBufferInfos[1])
  if (!stateBuffer0 || !stateBuffer1) return

  // Reset both ping-pong buffers to the same seed state.
  const seeded = buildInitialParticleState(
    particleCount,
    expandViewportBounds(viewport, options.simulationViewportPaddingRatio),
    options.maxAgeSec,
  )
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer0)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer1)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

function buildInitialParticleState(
  count: number,
  viewport: ViewportBounds | null,
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

function createVectorTexture(gl: WebGL2RenderingContext, frame: WindVectorTimeSliceData) {
  const componentBytes = frame.grid.nx * frame.grid.ny
  if (frame.u.length !== componentBytes || frame.v.length !== componentBytes) {
    console.warn('[particles] unexpected vector component sizes')
    return null
  }

  // Pack signed U/V into RG channels. RG8 halves upload size versus RGBA8.
  const bytes = new Uint8Array(componentBytes * 2)
  for (let i = 0; i < componentBytes; i += 1) {
    const base = i * 2
    bytes[base] = i8ToU8(frame.u[i])
    bytes[base + 1] = i8ToU8(frame.v[i])
  }

  let texture: WebGLTexture | null = null
  try {
    texture = gl.createTexture()
    if (!texture) return null

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG8,
      frame.grid.nx,
      frame.grid.ny,
      0,
      gl.RG,
      gl.UNSIGNED_BYTE,
      bytes,
    )
    gl.bindTexture(gl.TEXTURE_2D, null)

    return texture
  } catch (error) {
    gl.bindTexture(gl.TEXTURE_2D, null)
    if (texture) gl.deleteTexture(texture)
    console.warn('[particles] failed to create vector texture:', error)
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
      errorCallback: (msg: string) => console.warn(`[particles] ${errorLabel} program error:`, msg),
    })
  } catch (error) {
    console.warn(`[particles] failed to create ${errorLabel} program:`, error)
    return null
  }
}

function i8ToU8(value: number) {
  // Reinterpret i8 payload from normalized unsigned texture bytes.
  return value < 0 ? value + 256 : value
}

function isReady(state: ParticleState) {
  // Render/update requires all GPU resources plus a loaded frame.
  return Boolean(
    state.map &&
      state.gl &&
      state.viewport &&
      state.hasFrame &&
      state.vectorTextureLower &&
      state.vectorTextureUpper &&
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
