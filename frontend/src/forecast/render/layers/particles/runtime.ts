import type { ParticlesWindow } from '@/forecast/frames'
import {
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  type ParticleRenderSettings,
} from '@/forecast/settings/settings'
import type { MapFrameController } from '@/map/controllers'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import type { CustomLayerRuntime } from '../../maplibre/customLayer'
import { asWebGL2, createProgramInfo } from '../../gpu'
import {
  captureCameraState,
  computeViewportState,
  hasCameraChanged,
  type CameraState,
} from './geo'
import {
  compositeTrailToMap,
  runParticlePass,
  runTrailPass,
  runUpdatePass,
  type ParticlePassState,
} from './passes'
import {
  createParticleStateBufferPair,
  deleteParticleStateBufferPair,
  rebuildParticleStateBufferPair,
  reseedParticleStateBuffers,
} from './stateBuffers'
import {
  clearTrailTextures,
  createEmptyParticleTrailTargets,
  disposeTrailTargets,
  ensureTrailTargets,
  initializeTrailTargets,
} from './trailTargets'
import {
  createPackedVectorFramePair,
  deletePackedVectorFramePairTextures,
  packedVectorFramePairSignature,
} from './vectorTexture'
import {
  VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
  VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
  VECTOR_TRAIL_FRAGMENT_SHADER_SOURCE,
  VECTOR_TRAIL_VERTEX_SHADER_SOURCE,
  VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE,
  VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
} from './shaders'
import { clamp } from '@/core/math'

type ParticleState = ParticlePassState & {
  enabled: boolean
  lastFrameMs: number
  previousCameraState: CameraState | null
  zoomGestureActive: boolean
  zoomGestureStart: number
  zoomGestureMin: number
}

export type ParticlesController = MapFrameController<ParticlesWindow> & {
  applySettings: (settings: Partial<ParticleRenderSettings>) => void
}

export function createParticlesRuntime(
  controllerRegistry: RenderControllerLifecycle<ParticlesController>,
  initialSettings: Partial<ParticleRenderSettings> = DEFAULT_PARTICLE_RENDER_SETTINGS,
): CustomLayerRuntime {
  const settings: ParticleRenderSettings = {
    ...DEFAULT_PARTICLE_RENDER_SETTINGS,
    ...initialSettings,
  }
  const state: ParticleState = {
    enabled: true,
    lastFrameMs: 0,
    particleCount: settings.particleCount,
    viewport: null,
    vectorFramePair: null,
    updateProgramInfo: null,
    particleProgramInfo: null,
    trailProgramInfo: null,
    stateBufferInfos: [null, null],
    activeSourceIndex: 0,
    transformFeedback: null,
    trailTargets: createEmptyParticleTrailTargets(),
    previousCameraState: null,
    pendingForcedRespawnFrac: 0,
    zoomGestureActive: false,
    zoomGestureStart: 0,
    zoomGestureMin: 0,
  }
  const controller: ParticlesController = {
    isAvailable: () => isParticleRuntimeAvailable(state),
    applyFrame: (frame) => {
      if (!isParticleRuntimeAvailable(state) || !state.gl) {
        throw new Error('Particle runtime unavailable (WebGL2 required)')
      }
      applyParticlesWindowToState(state, frame, settings)
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      state.enabled = enabled
      state.map?.triggerRepaint()
    },
    applySettings: (nextSettings) => {
      applyParticlesRenderSettingsToState(state, settings, nextSettings)
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      controllerRegistry.register(map, controller)

      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) {
        console.warn('[particles] WebGL2 is required for GPU particle simulation')
        return
      }

      state.gl = gl2
      state.lastFrameMs = performance.now()
      state.viewport = computeViewportState(map)
      state.updateProgramInfo = createProgramInfo({
        gl: gl2,
        label: 'particles:update',
        vertexSource: VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
        fragmentSource: VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE,
        options: {
          attribLocations: { a_state: 0 },
          transformFeedbackVaryings: ['v_state'],
          transformFeedbackMode: gl2.SEPARATE_ATTRIBS,
        },
      })
      state.particleProgramInfo = createProgramInfo({
        gl: gl2,
        label: 'particles:particle',
        vertexSource: VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
        fragmentSource: VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
        options: { attribLocations: { a_state: 0 } },
      })
      state.trailProgramInfo = createProgramInfo({
        gl: gl2,
        label: 'particles:trail',
        vertexSource: VECTOR_TRAIL_VERTEX_SHADER_SOURCE,
        fragmentSource: VECTOR_TRAIL_FRAGMENT_SHADER_SOURCE,
        options: { attribLocations: { a_pos: 0 } },
      })
      if (!state.updateProgramInfo || !state.particleProgramInfo || !state.trailProgramInfo) {
        return
      }

      state.stateBufferInfos = createParticleStateBufferPair(
        gl2,
        state.particleCount,
        state.viewport,
        settings.simulationViewportPaddingRatio,
        settings.maxAgeSec,
      )
      if (!state.stateBufferInfos[0] || !state.stateBufferInfos[1]) {
        return
      }

      state.transformFeedback = gl2.createTransformFeedback()
      if (!state.transformFeedback) {
        return
      }

      if (!initializeTrailTargets(gl2, state.trailTargets) ||
        !ensureTrailTargets(gl2, state.trailTargets, settings)
      ) {
        return
      }

      state.previousCameraState = captureCameraState(state.map, state.gl)
      map.triggerRepaint()
    },

    render(gl) {
      const gl2 = asWebGL2(gl, 'createTransformFeedback')
      if (!gl2) return
      if (!state.enabled || !state.vectorFramePair) return
      if (!isReady(state)) return
      if (!state.map) return

      state.viewport = computeViewportState(state.map)
      updateZoomOutRespawnState(state, settings)

      const now = performance.now()
      const dtSec = clamp((now - state.lastFrameMs) / 1000, 0.001, 0.05)
      state.lastFrameMs = now

      if (!ensureTrailTargets(gl2, state.trailTargets, settings)) return

      const cameraChanged = didCameraChange(state)
      if (settings.clearTrailsOnViewChange && cameraChanged) {
        clearTrailTextures(gl2, state.trailTargets)
      }

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
      controllerRegistry.unregister(map)
      void gl
      const gl2 = state.gl

      if (gl2) {
        deletePackedVectorFramePairTextures(gl2, state.vectorFramePair)
        if (state.updateProgramInfo) gl2.deleteProgram(state.updateProgramInfo.program)
        if (state.particleProgramInfo) gl2.deleteProgram(state.particleProgramInfo.program)
        if (state.trailProgramInfo) gl2.deleteProgram(state.trailProgramInfo.program)
        deleteParticleStateBufferPair(gl2, state.stateBufferInfos)
        disposeTrailTargets(gl2, state.trailTargets)
        if (state.transformFeedback) gl2.deleteTransformFeedback(state.transformFeedback)
      }

      state.map = undefined
      state.gl = undefined
      state.enabled = true
      state.viewport = null
      state.vectorFramePair = null
      state.updateProgramInfo = null
      state.particleProgramInfo = null
      state.trailProgramInfo = null
      state.stateBufferInfos = [null, null]
      state.transformFeedback = null
      state.trailTargets = createEmptyParticleTrailTargets()
      state.previousCameraState = null
      state.pendingForcedRespawnFrac = 0
      state.zoomGestureActive = false
      state.zoomGestureStart = 0
      state.zoomGestureMin = 0
    },
  }
}

function applyParticlesWindowToState(
  state: ParticleState,
  window: ParticlesWindow,
  options: ParticleRenderSettings,
): void {
  const gl = state.gl
  if (!gl) return

  const previousFramePair = state.vectorFramePair
  const nextFramePair = createPackedVectorFramePair(gl, window, previousFramePair)
  if (!nextFramePair) return

  const didFramePairChange =
    packedVectorFramePairSignature(previousFramePair) !== packedVectorFramePairSignature(nextFramePair)

  deletePackedVectorFramePairTextures(gl, previousFramePair, nextFramePair)
  state.vectorFramePair = nextFramePair
  if (options.reseedOnFrameChange && didFramePairChange) {
    reseedParticleStateBuffers({
      gl,
      stateBufferInfos: state.stateBufferInfos,
      particleCount: state.particleCount,
      viewport: state.viewport,
      simulationViewportPaddingRatio: options.simulationViewportPaddingRatio,
      maxAgeSec: options.maxAgeSec,
    })
    state.activeSourceIndex = 0
    state.trailTargets.activeTrailSourceIndex = 0
    clearTrailTextures(gl, state.trailTargets)
  }
  state.lastFrameMs = performance.now()
}

function applyParticlesRenderSettingsToState(
  state: ParticleState,
  options: ParticleRenderSettings,
  nextOptions: Partial<ParticleRenderSettings>,
): void {
  const previousParticleCount = options.particleCount
  const nextParticleCount = nextOptions.particleCount == null
    ? options.particleCount
    : sanitizeParticleCount(nextOptions.particleCount)

  Object.assign(options, nextOptions)
  options.particleCount = nextParticleCount

  if (previousParticleCount !== nextParticleCount) {
    if (!state.gl) {
      state.particleCount = nextParticleCount
    } else {
      const nextBuffers = rebuildParticleStateBufferPair(
        state.gl,
        state.stateBufferInfos,
        nextParticleCount,
        state.viewport,
        options.simulationViewportPaddingRatio,
        options.maxAgeSec,
      )
      if (nextBuffers) {
        state.stateBufferInfos = nextBuffers
        state.particleCount = nextParticleCount
        state.activeSourceIndex = 0
        clearTrailTextures(state.gl, state.trailTargets)
      } else {
        options.particleCount = previousParticleCount
      }
    }
  }

  state.map?.triggerRepaint()
}

function sanitizeParticleCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PARTICLE_RENDER_SETTINGS.particleCount
  return Math.max(0, Math.floor(value))
}

function didCameraChange(state: ParticleState): boolean {
  const next = captureCameraState(state.map, state.gl)
  if (!next) return false
  const prev = state.previousCameraState
  state.previousCameraState = next
  if (!prev) return false
  return hasCameraChanged(prev, next)
}

function updateZoomOutRespawnState(state: ParticleState, options: ParticleRenderSettings): void {
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

function isParticleRuntimeAvailable(state: ParticleState): boolean {
  return Boolean(
    state.gl &&
      state.updateProgramInfo &&
      state.particleProgramInfo &&
      state.trailProgramInfo &&
      state.transformFeedback &&
      state.stateBufferInfos[0] &&
      state.stateBufferInfos[1] &&
      state.trailTargets.trailQuadBufferInfo &&
      state.trailTargets.trailFramebuffer &&
      state.trailTargets.trailTextures[0] &&
      state.trailTargets.trailTextures[1],
  )
}

function isReady(state: ParticleState): boolean {
  return Boolean(
    state.map &&
      state.viewport &&
      state.vectorFramePair &&
      isParticleRuntimeAvailable(state),
  )
}
