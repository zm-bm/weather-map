import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  asWebGL2,
  createProjectionProgramCache,
  createWrappedWorldQuad,
  deleteBufferInfo,
  WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
  type ProjectionProgramCache,
  type WrappedWorldQuad,
} from '../../gpu'
import { EncodedGridTextureCache } from '../../encodedGrid'
import type { CustomLayerRuntime } from '../../maplibre/customLayer'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import type { MapFrameController } from '@/map/controllers'
import type { OverlayWindow } from '@/forecast/frames'
import {
  createPrecipitationTypeOverlayEntries,
  drawPrecipitationTypeOverlayEntry,
  normalizePatternOpacity,
  stepPatternOpacity,
  type PrecipitationTypeOverlayRenderEntry,
} from './renderPaths/precipitationType'
import { OVERLAY_FRAGMENT_SHADER_SOURCE } from './shaders'

export type OverlayController = MapFrameController<OverlayWindow | null>

type OverlayState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  programCache: ProjectionProgramCache | null
  quad: WrappedWorldQuad | null
  overlayEntries: PrecipitationTypeOverlayRenderEntry[]
  textureCache: EncodedGridTextureCache
  patternOpacity: number
  patternOpacityTarget: number
  lastPatternOpacityMs: number | null
}

export function createOverlayRuntime(
  controllerRegistry: RenderControllerLifecycle<OverlayController>
): CustomLayerRuntime {
  const state: OverlayState = {
    programCache: null,
    quad: null,
    overlayEntries: [],
    textureCache: new EncodedGridTextureCache(),
    patternOpacity: 1,
    patternOpacityTarget: 1,
    lastPatternOpacityMs: null,
  }

  const handleZoomStart = () => setPatternOpacityTarget(state, 0)
  const handleZoom = () => setPatternOpacityTarget(state, 0)
  const handleZoomEnd = () => setPatternOpacityTarget(state, 1)

  const controller: OverlayController = {
    isAvailable: () => state.gl != null && state.programCache != null && state.quad != null,
    applyFrame: (frame) => {
      if (!state.gl || !state.programCache || !state.quad) {
        throw new Error('Overlay runtime unavailable')
      }

      if (frame == null) {
        state.overlayEntries = []
        state.map?.triggerRepaint()
        return
      }

      state.overlayEntries = createPrecipitationTypeOverlayEntries({
        gl: state.gl,
        textureCache: state.textureCache,
        previousEntries: state.overlayEntries,
        frame,
      })
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      if (!enabled) {
        state.overlayEntries = []
      }
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      controllerRegistry.register(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        console.warn('[overlay] WebGL2 is required for overlays')
        return
      }

      state.gl = gl2
      state.programCache = createProjectionProgramCache({
        gl: gl2,
        label: 'overlay',
        vertexSource: WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
        fragmentSource: OVERLAY_FRAGMENT_SHADER_SOURCE,
      })
      state.quad = createWrappedWorldQuad(gl2)

      if (!state.programCache || !state.quad) return

      map.on('zoomstart', handleZoomStart)
      map.on('zoom', handleZoom)
      map.on('zoomend', handleZoomEnd)
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !state.map || !state.programCache || !state.quad) return
      if (state.overlayEntries.length === 0) return
      const opacityStep = stepPatternOpacity({
        opacity: state.patternOpacity,
        target: state.patternOpacityTarget,
        elapsedMs: elapsedPatternOpacityMs(state),
      })
      state.patternOpacity = opacityStep.opacity
      state.lastPatternOpacityMs = readPerformanceNow()

      for (const entry of state.overlayEntries) {
        drawPrecipitationTypeOverlayEntry({
          gl: gl2,
          map: state.map,
          programCache: state.programCache,
          quad: state.quad,
          entry,
          input,
          patternOpacity: state.patternOpacity,
        })
      }

      if (opacityStep.needsRepaint) {
        state.map.triggerRepaint()
      }
    },

    onRemove(map) {
      controllerRegistry.unregister(map)
      map.off('zoomstart', handleZoomStart)
      map.off('zoom', handleZoom)
      map.off('zoomend', handleZoomEnd)
      const { gl } = state

      if (gl) {
        state.overlayEntries = []
        state.textureCache.clear(gl)
        if (state.quad) deleteBufferInfo(gl, state.quad)
        state.programCache?.clear()
      }

      state.map = undefined
      state.gl = undefined
      state.patternOpacity = 1
      state.patternOpacityTarget = 1
      state.lastPatternOpacityMs = null
      state.programCache = null
      state.quad = null
      state.overlayEntries = []
    },
  }
}

function setPatternOpacityTarget(state: OverlayState, target: number): void {
  const nextTarget = normalizePatternOpacity(target)
  if (Math.abs(state.patternOpacityTarget - nextTarget) <= 0.001) return
  state.patternOpacityTarget = nextTarget
  state.lastPatternOpacityMs = readPerformanceNow()
  state.map?.triggerRepaint()
}

function elapsedPatternOpacityMs(state: OverlayState): number {
  const now = readPerformanceNow()
  return state.lastPatternOpacityMs == null ? 0 : now - state.lastPatternOpacityMs
}

function readPerformanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
