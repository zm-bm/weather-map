import type { Map as MapLibreMap } from 'maplibre-gl'

import { clamp } from '@/core/math'
import { worldSizeAtZoom, worldWrapForLng } from '@/core/geo'
import type { PaletteSamplingMode } from '@/forecast/display/palette'
import type {
  RasterWindow,
} from '@/forecast/frames'
import {
  DEFAULT_RASTER_RENDER_SETTINGS,
  type RasterColorSamplingMode,
  type RasterGridSamplingMode,
  type RasterRenderSettings,
} from '@/forecast/settings/settings'
import type { MapFrameController } from '@/map/controllers'

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
import {
  EncodedGridTextureCache,
  encodedFramePairUniforms,
  encodedLinearUniforms,
  resolveEncodedFramePair,
  type EncodedFramePair,
  type EncodedGridFrameSpec,
} from '../../encodedGrid'
import type { CustomLayerRuntime } from '../../maplibre/customLayer'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import {
  buildRasterColormapLut,
  colormapEncodedGridFrameSpec,
  colormapRasterRenderSpec,
  createColormapKey,
  isColormapRasterFrame,
  type ColormapRasterRenderSpec,
} from './renderPaths/colormap'
import {
  CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE,
  COLORMAP_FRAGMENT_SHADER_SOURCE,
} from './shaders'
import {
  CLOUD_LAYERS_RENDER_PATH_ID,
  cloudLayersEncodedGridFrameSpec,
  cloudLayerColorUniforms,
  isCloudLayersRasterFrame,
} from './renderPaths/cloudLayers'
import { rasterSourceSamplingModeUniform } from './renderPaths/sampling'

const COLORMAP_LUT_SIZE = 256
const BANDED_COLORMAP_LUT_SIZE = 2048

type RasterFrame = RasterWindow['lower']
type RasterRenderPathId = 'colormap' | typeof CLOUD_LAYERS_RENDER_PATH_ID
type LinearRasterEncoding = {
  scale: number
  offset: number
}

export type RasterController = MapFrameController<RasterWindow | null> & {
  applySettings: (settings: RasterRenderSettings) => void
}

type RasterState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  enabled: boolean
  opacity: number
  gridSamplingMode: RasterGridSamplingMode
  colorSamplingMode: RasterColorSamplingMode
  colormapProgramInfo: ProgramInfo | null
  cloudLayersProgramInfo: ProgramInfo | null
  quad: WrappedWorldQuad | null
  textureCache: EncodedGridTextureCache
  framePair: EncodedFramePair<RasterFrame> | null
  activeRenderPathId: RasterRenderPathId | null
  colormapRenderSpec: ColormapRasterRenderSpec | null
  colormapTextureInterpolated: WebGLTexture | null
  colormapTextureBanded: WebGLTexture | null
  colormapKey: string | null
}

type RasterRenderPath = {
  id: RasterRenderPathId
  matches: (frame: RasterFrame) => boolean
  frameSpec: (frame: RasterFrame) => EncodedGridFrameSpec
  applyFrame?: (
    gl: WebGL2RenderingContext,
    state: RasterState,
    lowerFrame: RasterFrame
  ) => void
  render: (
    state: RasterState,
    gl: WebGL2RenderingContext,
    matrix: unknown
  ) => void
  clear?: (state: RasterState) => void
}

const RASTER_RENDER_PATHS: readonly RasterRenderPath[] = [
  {
    id: 'colormap',
    matches: isColormapRasterFrame,
    frameSpec: colormapEncodedGridFrameSpec,
    applyFrame: applyColormapRasterFrame,
    render: renderColormapRaster,
    clear: clearColormapRasterTextures,
  },
  {
    id: CLOUD_LAYERS_RENDER_PATH_ID,
    matches: isCloudLayersRasterFrame,
    frameSpec: cloudLayersEncodedGridFrameSpec,
    render: renderCloudLayersRaster,
  },
]

export function createRasterRuntime(
  controllerRegistry: RenderControllerLifecycle<RasterController>,
  initialSettings: RasterRenderSettings = DEFAULT_RASTER_RENDER_SETTINGS
): CustomLayerRuntime {
  const initialOpacity = sanitizeOpacity(initialSettings.opacity)
  const settings: RasterRenderSettings = {
    ...DEFAULT_RASTER_RENDER_SETTINGS,
    ...initialSettings,
    opacity: initialOpacity,
  }
  const state: RasterState = {
    enabled: true,
    opacity: initialOpacity,
    gridSamplingMode: settings.gridSamplingMode,
    colorSamplingMode: settings.colorSamplingMode,
    colormapProgramInfo: null,
    cloudLayersProgramInfo: null,
    quad: null,
    textureCache: new EncodedGridTextureCache(),
    framePair: null,
    activeRenderPathId: null,
    colormapRenderSpec: null,
    colormapTextureInterpolated: null,
    colormapTextureBanded: null,
    colormapKey: null,
  }

  const controller: RasterController = {
    isAvailable: () => (
      state.gl != null &&
      state.colormapProgramInfo != null &&
      state.cloudLayersProgramInfo != null &&
      state.quad != null
    ),
    applyFrame: (frame) => {
      if (!state.gl || !state.colormapProgramInfo || !state.cloudLayersProgramInfo || !state.quad) {
        throw new Error('Raster runtime unavailable')
      }
      const gl = state.gl
      if (frame == null) {
        clearRasterFrame(state)
        state.map?.triggerRepaint()
        return
      }

      const renderPath = rasterRenderPathForWindow(frame)
      const previousRenderPath = rasterRenderPathById(state.activeRenderPathId)
      const resolvedFramePair = resolveEncodedFramePair({
        gl,
        textureCache: state.textureCache,
        current: state.framePair,
        lowerFrame: frame.lower,
        upperFrame: frame.upper,
        mix: frame.mix,
        frameSpec: renderPath.frameSpec,
      })
      if (!resolvedFramePair) {
        throw new Error('Failed to create raster texture')
      }

      if (previousRenderPath && previousRenderPath.id !== renderPath.id) {
        previousRenderPath.clear?.(state)
      }
      renderPath.applyFrame?.(gl, state, resolvedFramePair.lowerFrame)

      state.framePair = resolvedFramePair
      state.activeRenderPathId = renderPath.id
      state.gridSamplingMode = settings.gridSamplingMode
      state.colorSamplingMode = settings.colorSamplingMode
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      state.enabled = enabled
      state.map?.triggerRepaint()
    },
    applySettings: (nextSettings) => {
      const nextOpacity = sanitizeOpacity(nextSettings.opacity)
      if (
        settings.gridSamplingMode === nextSettings.gridSamplingMode &&
        settings.colorSamplingMode === nextSettings.colorSamplingMode &&
        settings.opacity === nextOpacity
      ) return
      settings.gridSamplingMode = nextSettings.gridSamplingMode
      settings.colorSamplingMode = nextSettings.colorSamplingMode
      settings.opacity = nextOpacity
      state.gridSamplingMode = nextSettings.gridSamplingMode
      state.colorSamplingMode = nextSettings.colorSamplingMode
      state.opacity = nextOpacity
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      controllerRegistry.register(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        console.warn('[raster] WebGL2 is required for raster rendering')
        return
      }

      state.gl = gl2
      state.colormapProgramInfo = createProgramInfo({
        gl: gl2,
        label: 'raster:colormap',
        vertexSource: WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
        fragmentSource: COLORMAP_FRAGMENT_SHADER_SOURCE,
      })
      state.cloudLayersProgramInfo = createProgramInfo({
        gl: gl2,
        label: 'raster:cloud-layers',
        vertexSource: WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
        fragmentSource: CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE,
      })
      state.quad = createWrappedWorldQuad(gl2)
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !state.map || !state.quad || !state.enabled || state.opacity <= 0) return
      const { framePair, activeRenderPathId } = state
      if (!framePair || !activeRenderPathId) return

      rasterRenderPathById(activeRenderPathId)?.render(state, gl2, input.modelViewProjectionMatrix)
    },

    onRemove(map) {
      controllerRegistry.unregister(map)
      const { gl } = state

      if (gl) {
        clearRasterFrame(state)
        state.textureCache.clear(gl)
        if (state.quad) deleteBufferInfo(gl, state.quad)
        if (state.colormapProgramInfo) gl.deleteProgram(state.colormapProgramInfo.program)
        if (state.cloudLayersProgramInfo) gl.deleteProgram(state.cloudLayersProgramInfo.program)
      }

      state.map = undefined
      state.gl = undefined
      state.enabled = true
      state.framePair = null
      state.activeRenderPathId = null
      state.colormapProgramInfo = null
      state.cloudLayersProgramInfo = null
      state.quad = null
    },
  }
}

function applyColormapRasterFrame(
  gl: WebGL2RenderingContext,
  state: RasterState,
  lowerFrame: RasterFrame
): void {
  if (!isColormapRasterFrame(lowerFrame)) {
    throw new Error('Colormap raster received non-colormap source')
  }
  const renderSpec = colormapRasterRenderSpec(lowerFrame)
  const nextColormapKey = createColormapKey(lowerFrame)
  const shouldRebuildColormap = (
    state.colormapKey !== nextColormapKey ||
    !state.colormapTextureInterpolated ||
    !state.colormapTextureBanded
  )

  let nextColormapTextureInterpolated = state.colormapTextureInterpolated
  let nextColormapTextureBanded = state.colormapTextureBanded

  if (shouldRebuildColormap) {
    nextColormapTextureInterpolated = createColormapTexture(gl, lowerFrame, 'interpolated')
    if (!nextColormapTextureInterpolated) {
      throw new Error('Failed to create raster colormap texture')
    }

    nextColormapTextureBanded = createColormapTexture(gl, lowerFrame, 'banded')
    if (!nextColormapTextureBanded) {
      gl.deleteTexture(nextColormapTextureInterpolated)
      throw new Error('Failed to create raster colormap texture')
    }
  }

  if (shouldRebuildColormap) {
    if (state.colormapTextureInterpolated) gl.deleteTexture(state.colormapTextureInterpolated)
    if (state.colormapTextureBanded) gl.deleteTexture(state.colormapTextureBanded)
  }

  state.colormapRenderSpec = renderSpec
  if (shouldRebuildColormap) {
    state.colormapTextureInterpolated = nextColormapTextureInterpolated
    state.colormapTextureBanded = nextColormapTextureBanded
    state.colormapKey = nextColormapKey
  }
}

function renderColormapRaster(
  state: RasterState,
  gl: WebGL2RenderingContext,
  matrix: unknown
): void {
  const { framePair, colormapRenderSpec, colormapProgramInfo } = state
  if (!state.map || !framePair || !colormapRenderSpec || !colormapProgramInfo) return
  if (!isColormapRasterFrame(framePair.lowerFrame)) return

  const colormapTexture = paletteSamplingModeForRaster(state.colorSamplingMode) === 'banded'
    ? state.colormapTextureBanded
    : state.colormapTextureInterpolated
  if (!colormapTexture) return

  drawWrappedWorldCopies({
    gl,
    programInfo: colormapProgramInfo,
    quad: state.quad!,
    centerWrap: worldWrapForLng(state.map.getCenter().lng),
    uniforms: {
      ...encodedFramePairUniforms(framePair),
      u_colormap_tex: colormapTexture,
      u_display_range: displayRangeUniform(framePair.lowerFrame.source.display.range),
      u_source_mode: colormapRenderSpec.mode,
      u_source_sampling_mode: rasterSourceSamplingModeUniform(state.gridSamplingMode),
      ...encodedLinearUniforms(colormapRenderSpec),
      u_matrix: matrix,
      u_opacity: state.opacity,
      u_world_size: worldSizeAtZoom(state.map.getZoom()),
    },
  })
}

function displayRangeUniform(displayRange: RasterFrame['source']['display']['range']): [number, number] {
  return [displayRange.min, displayRange.max]
}

function renderCloudLayersRaster(
  state: RasterState,
  gl: WebGL2RenderingContext,
  matrix: unknown
): void {
  const { framePair, cloudLayersProgramInfo } = state
  if (!state.map || !framePair || !cloudLayersProgramInfo) return

  const zoom = state.map.getZoom()
  const worldSize = worldSizeAtZoom(zoom)
  const encoding = framePair.lowerFrame.raster.encoding as LinearRasterEncoding

  drawWrappedWorldCopies({
    gl,
    programInfo: cloudLayersProgramInfo,
    quad: state.quad!,
    centerWrap: worldWrapForLng(state.map.getCenter().lng),
    uniforms: {
      ...encodedFramePairUniforms(framePair),
      u_matrix: matrix,
      u_scale: encoding.scale,
      u_offset: encoding.offset,
      u_opacity: state.opacity,
      u_world_size: worldSize,
      u_zoom: zoom,
      u_source_sampling_mode: rasterSourceSamplingModeUniform(state.gridSamplingMode),
      ...cloudLayerColorUniforms(framePair.lowerFrame),
    },
  })
}

function clearRasterFrame(state: RasterState): void {
  rasterRenderPathById(state.activeRenderPathId)?.clear?.(state)
  state.framePair = null
  state.activeRenderPathId = null
}

function clearColormapRasterTextures(state: RasterState): void {
  if (state.gl) {
    if (state.colormapTextureInterpolated) state.gl.deleteTexture(state.colormapTextureInterpolated)
    if (state.colormapTextureBanded) state.gl.deleteTexture(state.colormapTextureBanded)
  }
  state.colormapRenderSpec = null
  state.colormapTextureInterpolated = null
  state.colormapTextureBanded = null
  state.colormapKey = null
}

function rasterRenderPathForWindow(frame: RasterWindow): RasterRenderPath {
  const lowerRenderPath = rasterRenderPathForFrame(frame.lower)
  const upperRenderPath = rasterRenderPathForFrame(frame.upper)
  if (lowerRenderPath.id !== upperRenderPath.id) {
    throw new Error(`Raster frame render path mismatch: lower=${lowerRenderPath.id} upper=${upperRenderPath.id}`)
  }
  return lowerRenderPath
}

function rasterRenderPathForFrame(frame: RasterFrame): RasterRenderPath {
  const renderPath = RASTER_RENDER_PATHS.find((entry) => entry.matches(frame))
  if (!renderPath) {
    throw new Error(`Unsupported raster source for ${frame.source.layerId}`)
  }
  return renderPath
}

function rasterRenderPathById(id: RasterRenderPathId | null): RasterRenderPath | null {
  return RASTER_RENDER_PATHS.find((entry) => entry.id === id) ?? null
}

function sanitizeOpacity(value: number): number {
  return clamp(Number.isFinite(value) ? value : DEFAULT_RASTER_RENDER_SETTINGS.opacity, 0, 1)
}

function createColormapTexture(
  gl: WebGL2RenderingContext,
  frame: RasterFrame,
  paletteSamplingMode: PaletteSamplingMode
): WebGLTexture | null {
  const texture = gl.createTexture()
  if (!texture) return null

  const lutSize = paletteSamplingMode === 'banded'
    ? BANDED_COLORMAP_LUT_SIZE
    : COLORMAP_LUT_SIZE
  const lut = buildRasterColormapLut(frame, lutSize, paletteSamplingMode)

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  // Interpolated mode blends texels; banded mode uses threshold colors from exact texels.
  if (paletteSamplingMode === 'banded') {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lutSize, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function paletteSamplingModeForRaster(colorSamplingMode: RasterColorSamplingMode): PaletteSamplingMode {
  return colorSamplingMode === 'gradient' ? 'interpolated' : 'banded'
}
