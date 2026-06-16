import type { Map as MapLibreMap } from 'maplibre-gl'

import { worldSizeAtZoom, worldWrapForLng } from '@/core/geo'
import {
  type ContourWindow,
} from '@/forecast/frames'
import {
  EncodedGridTextureCache,
  encodedGridUniforms,
  resolveEncodedFramePair,
  type EncodedFramePair,
} from '../../encodedGrid'
import {
  asWebGL2,
  createProgramInfo,
  createWrappedWorldQuad,
  deleteBufferInfo,
  drawWrappedWorldCopies,
  WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
  type ProgramInfo,
  type WrappedWorldQuad,
} from '../../gpu'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import type { CustomLayerRuntime } from '../../maplibre/customLayer'
import type { MapFrameController } from '@/map/controllers'
import {
  PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE,
} from './shaders'
import {
  createPressurePrefilter,
  createSmoothedPressureFramePair,
  disposePressurePrefilter,
  type PressurePrefilter,
} from './renderPaths/pressurePrefilter'
import {
  pressureEncodedGridFrameSpec,
  pressureFramePairRenderSpec,
  type PressureEncodingRenderSpec,
} from './renderPaths/pressure'

export type ContourController = MapFrameController<ContourWindow | null>

type ContourWindowFrame = ContourWindow['lower']

type ContourState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  enabled: boolean
  programInfo: ProgramInfo | null
  prefilter: PressurePrefilter | null
  quad: WrappedWorldQuad | null
  rawTextureCache: EncodedGridTextureCache
  rawFramePair: EncodedFramePair<ContourWindowFrame> | null
  smoothedFramePair: EncodedFramePair<ContourWindowFrame> | null
  renderSpec: PressureEncodingRenderSpec | null
}

export function createContourRuntime(
  controllerRegistry: RenderControllerLifecycle<ContourController>
): CustomLayerRuntime {
  const state: ContourState = {
    enabled: true,
    programInfo: null,
    prefilter: null,
    quad: null,
    rawTextureCache: new EncodedGridTextureCache(),
    rawFramePair: null,
    smoothedFramePair: null,
    renderSpec: null,
  }

  const controller: ContourController = {
    isAvailable: () => isContourAvailable(state),
    applyFrame: (frame) => {
      if (!isContourAvailable(state)) throw new Error('Contour runtime unavailable')
      applyPressureContourWindow(state, frame)
    },
    setEnabled: (enabled) => {
      state.enabled = enabled
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      controllerRegistry.register(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        console.warn('[contour] WebGL2 is required for pressure contours')
        return
      }

      state.gl = gl2
      state.programInfo = createProgramInfo({
        gl: gl2,
        label: 'contour',
        vertexSource: WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
        fragmentSource: PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE,
      })
      state.quad = createWrappedWorldQuad(gl2)
      state.prefilter = createPressurePrefilter(gl2)

      if (!state.programInfo || !state.quad) {
        return
      }
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !isContourAvailable(state) || !state.map || !state.quad) return
      const { rawFramePair, renderSpec } = state
      if (!state.enabled || !rawFramePair || !renderSpec) return

      const { smoothedFramePair } = state
      const programInfo = state.programInfo
      if (!smoothedFramePair) return
      if (!programInfo) return

      drawWrappedWorldCopies({
        gl: gl2,
        programInfo,
        quad: state.quad,
        centerWrap: worldWrapForLng(state.map.getCenter().lng),
        uniforms: {
          u_pressure_tex_lower: smoothedFramePair.lowerTexture,
          u_pressure_tex_upper: smoothedFramePair.upperTexture,
          ...encodedGridUniforms(rawFramePair.lowerFrame.raster.grid),
          u_time_mix: smoothedFramePair.timeMix,
          u_matrix: input.modelViewProjectionMatrix,
          u_world_size: worldSizeAtZoom(state.map.getZoom()),
        },
      })
    },

    onRemove(map) {
      controllerRegistry.unregister(map)
      const { gl } = state

      if (gl) {
        clearPressureFrameState(state)
        state.rawTextureCache.clear(gl)
        if (state.prefilter) disposePressurePrefilter(gl, state.prefilter)
        if (state.quad) deleteBufferInfo(gl, state.quad)
        if (state.programInfo) gl.deleteProgram(state.programInfo.program)
      }

      state.map = undefined
      state.gl = undefined
      state.enabled = true
      state.rawFramePair = null
      state.smoothedFramePair = null
      state.renderSpec = null
      state.programInfo = null
      state.prefilter = null
      state.quad = null
    },
  }
}

function applyPressureContourWindow(
  state: ContourState,
  frame: ContourWindow | null
): void {
  if (!state.gl || !state.quad) return
  if (frame == null) {
    clearPressureFrameState(state)
    state.map?.triggerRepaint()
    return
  }

  const lowerFrame = frame.lower
  const upperFrame = frame.mix > 0 ? frame.upper : frame.lower
  const renderSpec = pressureFramePairRenderSpec(lowerFrame, upperFrame)

  const rawFramePair = resolveEncodedFramePair({
    gl: state.gl,
    textureCache: state.rawTextureCache,
    current: state.rawFramePair,
    lowerFrame,
    upperFrame,
    mix: frame.mix,
    frameSpec: pressureEncodedGridFrameSpec,
  })
  if (!rawFramePair) throw new Error('Failed to create raw pressure contour texture')

  state.rawFramePair = rawFramePair
  state.smoothedFramePair = createSmoothedPressureFramePair({
    gl: state.gl,
    prefilter: state.prefilter,
    quad: state.quad,
    rawFramePair,
    renderSpec,
  })
  state.renderSpec = renderSpec
  state.map?.triggerRepaint()
}

function clearPressureFrameState(state: ContourState): void {
  state.rawFramePair = null
  state.smoothedFramePair = null
  state.renderSpec = null
}

function isContourAvailable(state: ContourState): boolean {
  return state.gl != null &&
    state.programInfo != null &&
    state.quad != null &&
    state.prefilter?.available === true
}
