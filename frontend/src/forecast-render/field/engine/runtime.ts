import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import type { LayerColortableStop } from '../../../forecast-manifest'
import {
  SCALAR_FRAGMENT_SHADER_SOURCE,
  SCALAR_VERTEX_SHADER_SOURCE,
} from './shaders'
import {
  BANDED_COLORMAP_LUT_SIZE,
  FIELD_ACTIVE_OPACITY,
  COLORMAP_LUT_SIZE,
  WORLD_WRAP_COPY_OFFSETS,
} from './constants'
import {
  asWebGL2,
} from '../../shared/webgl'
import {
  registerFieldController,
  unregisterFieldController,
  type FieldController,
} from '../controller'
import {
  type FieldTimeSliceData,
} from '../../../forecast-data'
import {
  DEFAULT_FIELD_RUNTIME_OPTIONS,
  type FieldColorSamplingMode,
  type FieldRuntimeOptions,
} from '../options'

type NormalizedColortableStop = [number, number, number, number]

export const MAX_CLASSIFIER_VALUE_MAPPINGS = 16

type TexturePair = {
  lower: WebGLTexture
  upper: WebGLTexture
}

export type ClassifierRowMapping = {
  values: Int32Array
  rows: Int32Array
  count: number
}

type FieldRendererState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  available: boolean
  hasFrame: boolean
  opacity: number
  // Active LUT sampling mode.
  colorSamplingMode: FieldColorSamplingMode
  // Field program + fullscreen-quad geometry.
  program: WebGLProgram | null
  vao: WebGLVertexArrayObject | null
  vertexBuffer: WebGLBuffer | null
  // Field value texture + cached colormap LUT textures.
  scalarTexture: WebGLTexture | null
  scalarTextureUpper: WebGLTexture | null
  scalarFrameLower: FieldTimeSliceData | null
  scalarFrameUpper: FieldTimeSliceData | null
  classifierTexture: TexturePair | null
  colormapTextureInterpolated: WebGLTexture | null
  colormapTextureBanded: WebGLTexture | null
  colormapRowCount: number
  classifierMapping: ClassifierRowMapping
  // Colormap rebuild cache key.
  colormapKey: string | null
  // Grid shape and georeferencing for shader sampling.
  gridNx: number
  gridNy: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  // LUT display range.
  displayMin: number
  displayMax: number
  timeMix: number
  // Uniform handles resolved during onAdd.
  uniforms: {
    scalarTex: WebGLUniformLocation | null
    scalarTexUpper: WebGLUniformLocation | null
    colormapTex: WebGLUniformLocation | null
    classifierTex: WebGLUniformLocation | null
    classifierTexUpper: WebGLUniformLocation | null
    classifierEnabled: WebGLUniformLocation | null
    classifierValueCount: WebGLUniformLocation | null
    classifierValues: WebGLUniformLocation | null
    classifierRows: WebGLUniformLocation | null
    colormapRowCount: WebGLUniformLocation | null
    gridSize: WebGLUniformLocation | null
    displayRange: WebGLUniformLocation | null
    timeMix: WebGLUniformLocation | null
    matrix: WebGLUniformLocation | null
    worldOffsetX: WebGLUniformLocation | null
    worldSize: WebGLUniformLocation | null
    lon0: WebGLUniformLocation | null
    lat0: WebGLUniformLocation | null
    dx: WebGLUniformLocation | null
    dy: WebGLUniformLocation | null
    opacity: WebGLUniformLocation | null
  }
}

export type FieldRendererRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput
  ) => void
  onRemove: (_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createFieldRuntime(
  options: FieldRuntimeOptions = DEFAULT_FIELD_RUNTIME_OPTIONS
): FieldRendererRuntime {
  const state: FieldRendererState = {
    available: false,
    hasFrame: false,
    opacity: FIELD_ACTIVE_OPACITY,
    colorSamplingMode: options.colorSamplingMode,
    program: null,
    vao: null,
    vertexBuffer: null,
    scalarTexture: null,
    scalarTextureUpper: null,
    scalarFrameLower: null,
    scalarFrameUpper: null,
    classifierTexture: null,
    colormapTextureInterpolated: null,
    colormapTextureBanded: null,
    colormapRowCount: 1,
    classifierMapping: emptyClassifierRowMapping(),
    colormapKey: null,
    gridNx: 0,
    gridNy: 0,
    lon0: 0,
    lat0: 0,
    dx: 1,
    dy: 1,
    displayMin: 0,
    displayMax: 1,
    timeMix: 0,
    uniforms: {
      scalarTex: null,
      scalarTexUpper: null,
      colormapTex: null,
      classifierTex: null,
      classifierTexUpper: null,
      classifierEnabled: null,
      classifierValueCount: null,
      classifierValues: null,
      classifierRows: null,
      colormapRowCount: null,
      gridSize: null,
      displayRange: null,
      timeMix: null,
      matrix: null,
      worldOffsetX: null,
      worldSize: null,
      lon0: null,
      lat0: null,
      dx: null,
      dy: null,
      opacity: null,
    },
  }

  const controller: FieldController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Field runtime unavailable')
      const { gl } = state
      const lowerFrame = frame.lower
      const upperFrame = frame.mix > 0
        ? frame.upper
        : frame.lower
      const expectedCellCount = lowerFrame.grid.nx * lowerFrame.grid.ny
      if (lowerFrame.values.length !== expectedCellCount) {
        throw new Error(`Unexpected scalar grid size for ${lowerFrame.layerId}: got=${lowerFrame.values.length} expected=${expectedCellCount}`)
      }

      const previousScalarTexture = state.scalarTexture
      const previousScalarTextureUpper = state.scalarTextureUpper
      const previousClassifierTexture = state.classifierTexture
      const reusableLowerTexture = findReusableScalarTexture(state, lowerFrame)
      const reusableUpperTexture = upperFrame === lowerFrame
        ? reusableLowerTexture
        : findReusableScalarTexture(state, upperFrame)
      const createdLowerTexture = reusableLowerTexture
        ? null
        : createFrameTexture(
          gl,
          lowerFrame,
        )
      const nextScalarTexture = reusableLowerTexture ?? createdLowerTexture
      if (!nextScalarTexture) throw new Error('Failed to create field texture')

      const createdUpperTexture = upperFrame === lowerFrame || reusableUpperTexture
        ? null
        : createFrameTexture(
          gl,
          upperFrame,
        )
      const nextScalarTextureUpper = upperFrame === lowerFrame
        ? nextScalarTexture
        : reusableUpperTexture ?? createdUpperTexture
      if (!nextScalarTextureUpper) {
        if (createdLowerTexture) gl.deleteTexture(createdLowerTexture)
        throw new Error('Failed to create field texture')
      }

      const nextColormapKey = createColormapKey(lowerFrame)
      const shouldRebuildColormap = (
        state.colormapKey !== nextColormapKey ||
        !state.colormapTextureInterpolated ||
        !state.colormapTextureBanded
      )

      let nextColormapTextureInterpolated = state.colormapTextureInterpolated
      let nextColormapTextureBanded = state.colormapTextureBanded

      if (shouldRebuildColormap) {
        nextColormapTextureInterpolated = createColormapTexture(
          gl,
          lowerFrame,
          'interpolated'
        )
        if (!nextColormapTextureInterpolated) {
          if (createdLowerTexture) gl.deleteTexture(createdLowerTexture)
          if (createdUpperTexture) gl.deleteTexture(createdUpperTexture)
          throw new Error('Failed to create field colormap texture')
        }

        nextColormapTextureBanded = createColormapTexture(
          gl,
          lowerFrame,
          'banded'
        )
        if (!nextColormapTextureBanded) {
          if (createdLowerTexture) gl.deleteTexture(createdLowerTexture)
          if (createdUpperTexture) gl.deleteTexture(createdUpperTexture)
          gl.deleteTexture(nextColormapTextureInterpolated)
          throw new Error('Failed to create field colormap texture')
        }
      }

      const nextClassifierTexture = createClassifierTexturePair(gl, lowerFrame, upperFrame)
      const nextClassifierMapping = nextClassifierTexture
        ? buildClassifierRowMapping(lowerFrame.classifiedColoring)
        : emptyClassifierRowMapping()

      deleteUnusedScalarTexture(gl, previousScalarTexture, nextScalarTexture, nextScalarTextureUpper)
      deleteUnusedScalarTexture(gl, previousScalarTextureUpper, nextScalarTexture, nextScalarTextureUpper)
      deleteTexturePair(gl, previousClassifierTexture)
      if (shouldRebuildColormap) {
        if (state.colormapTextureInterpolated) gl.deleteTexture(state.colormapTextureInterpolated)
        if (state.colormapTextureBanded) gl.deleteTexture(state.colormapTextureBanded)
      }

      state.scalarTexture = nextScalarTexture
      state.scalarTextureUpper = nextScalarTextureUpper
      state.scalarFrameLower = lowerFrame
      state.scalarFrameUpper = upperFrame
      state.classifierTexture = nextClassifierTexture
      state.classifierMapping = nextClassifierMapping
      if (shouldRebuildColormap) {
        state.colormapTextureInterpolated = nextColormapTextureInterpolated
        state.colormapTextureBanded = nextColormapTextureBanded
        state.colormapKey = nextColormapKey
      }
      state.colormapRowCount = colormapRowsForFrame(lowerFrame).length
      state.gridNx = lowerFrame.grid.nx
      state.gridNy = lowerFrame.grid.ny
      state.lon0 = lowerFrame.grid.lon0
      state.lat0 = lowerFrame.grid.lat0
      state.dx = lowerFrame.grid.dx
      state.dy = lowerFrame.grid.dy
      state.displayMin = lowerFrame.displayRange[0]
      state.displayMax = lowerFrame.displayRange[1]
      state.timeMix = upperFrame === lowerFrame ? 0 : frame.mix
      state.colorSamplingMode = options.colorSamplingMode
      state.hasFrame = true
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      state.opacity = enabled ? FIELD_ACTIVE_OPACITY : 0
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerFieldController(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        state.available = false
        console.warn('[field] WebGL2 is required for scalar rendering')
        return
      }

      state.gl = gl2
      state.program = createProgram(gl2, SCALAR_VERTEX_SHADER_SOURCE, SCALAR_FRAGMENT_SHADER_SOURCE)
      state.vertexBuffer = createWrappedWorldVertexBuffer(gl2)
      state.vao = createVao(gl2, state.vertexBuffer)

      if (!state.program || !state.vertexBuffer || !state.vao) {
        state.available = false
        return
      }

      state.uniforms = {
        scalarTex: gl2.getUniformLocation(state.program, 'u_scalar_tex'),
        scalarTexUpper: gl2.getUniformLocation(state.program, 'u_scalar_tex_upper'),
        colormapTex: gl2.getUniformLocation(state.program, 'u_colormap_tex'),
        classifierTex: gl2.getUniformLocation(state.program, 'u_classifier_tex'),
        classifierTexUpper: gl2.getUniformLocation(state.program, 'u_classifier_tex_upper'),
        classifierEnabled: gl2.getUniformLocation(state.program, 'u_classifier_enabled'),
        classifierValueCount: gl2.getUniformLocation(state.program, 'u_classifier_value_count'),
        classifierValues: gl2.getUniformLocation(state.program, 'u_classifier_values'),
        classifierRows: gl2.getUniformLocation(state.program, 'u_classifier_rows'),
        colormapRowCount: gl2.getUniformLocation(state.program, 'u_colormap_row_count'),
        gridSize: gl2.getUniformLocation(state.program, 'u_grid_size'),
        displayRange: gl2.getUniformLocation(state.program, 'u_display_range'),
        timeMix: gl2.getUniformLocation(state.program, 'u_time_mix'),
        matrix: gl2.getUniformLocation(state.program, 'u_matrix'),
        worldOffsetX: gl2.getUniformLocation(state.program, 'u_world_offset_x'),
        worldSize: gl2.getUniformLocation(state.program, 'u_world_size'),
        lon0: gl2.getUniformLocation(state.program, 'u_lon0'),
        lat0: gl2.getUniformLocation(state.program, 'u_lat0'),
        dx: gl2.getUniformLocation(state.program, 'u_dx'),
        dy: gl2.getUniformLocation(state.program, 'u_dy'),
        opacity: gl2.getUniformLocation(state.program, 'u_opacity'),
      }

      state.available = true
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !state.available || !state.map || !state.program || !state.vao) return
      if (!state.scalarTexture || !state.scalarTextureUpper || !state.hasFrame || state.opacity <= 0) return

      // Pick the active LUT texture from runtime options.
      state.colorSamplingMode = options.colorSamplingMode
      const colormapTexture = state.colorSamplingMode === 'banded'
        ? state.colormapTextureBanded
        : state.colormapTextureInterpolated
      if (!colormapTexture) return

      // Bind scalar/colormap textures and upload render uniforms.
      gl2.useProgram(state.program)
      gl2.bindVertexArray(state.vao)

      gl2.activeTexture(gl2.TEXTURE0)
      gl2.bindTexture(gl2.TEXTURE_2D, state.scalarTexture)
      gl2.activeTexture(gl2.TEXTURE1)
      gl2.bindTexture(gl2.TEXTURE_2D, state.scalarTextureUpper)
      if (colormapTexture) {
        gl2.activeTexture(gl2.TEXTURE2)
        gl2.bindTexture(gl2.TEXTURE_2D, colormapTexture)
      }
      bindTexturePair(gl2, 3, state.classifierTexture, state.scalarTexture, 'lower')
      bindTexturePair(gl2, 4, state.classifierTexture, state.scalarTextureUpper, 'upper')

      gl2.uniform1i(state.uniforms.scalarTex, 0)
      gl2.uniform1i(state.uniforms.scalarTexUpper, 1)
      if (colormapTexture) {
        gl2.uniform1i(state.uniforms.colormapTex, 2)
      }
      gl2.uniform1i(state.uniforms.classifierTex, 3)
      gl2.uniform1i(state.uniforms.classifierTexUpper, 4)
      gl2.uniform1i(state.uniforms.classifierEnabled, state.classifierTexture && state.classifierMapping.count > 0 ? 1 : 0)
      gl2.uniform1i(state.uniforms.classifierValueCount, state.classifierMapping.count)
      gl2.uniform1iv(state.uniforms.classifierValues, state.classifierMapping.values)
      gl2.uniform1iv(state.uniforms.classifierRows, state.classifierMapping.rows)
      gl2.uniform1f(state.uniforms.colormapRowCount, state.colormapRowCount)
      gl2.uniform2f(state.uniforms.gridSize, state.gridNx, state.gridNy)
      gl2.uniform2f(state.uniforms.displayRange, state.displayMin, state.displayMax)
      gl2.uniform1f(state.uniforms.timeMix, state.timeMix)
      gl2.uniformMatrix4fv(state.uniforms.matrix, false, input.modelViewProjectionMatrix)
      gl2.uniform1f(state.uniforms.lon0, state.lon0)
      gl2.uniform1f(state.uniforms.lat0, state.lat0)
      gl2.uniform1f(state.uniforms.dx, state.dx)
      gl2.uniform1f(state.uniforms.dy, state.dy)
      gl2.uniform1f(state.uniforms.opacity, state.opacity)
      gl2.uniform1f(state.uniforms.worldSize, computeWorldSizeAtZoom(state.map.getZoom()))

      gl2.disable(gl2.DEPTH_TEST)
      gl2.enable(gl2.BLEND)
      gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA)

      // Draw wrapped-world copies to avoid dateline seams.
      const centerWrap = computeCenterWorldWrap(state.map.getCenter().lng)
      for (const relativeOffset of WORLD_WRAP_COPY_OFFSETS) {
        gl2.uniform1f(state.uniforms.worldOffsetX, centerWrap + relativeOffset)
        gl2.drawArrays(gl2.TRIANGLES, 0, 6)
      }

      gl2.disable(gl2.BLEND)

      gl2.bindVertexArray(null)
      gl2.useProgram(null)
    },

    onRemove(map) {
      unregisterFieldController(map)
      const { gl } = state

      if (gl) {
        deleteUnusedScalarTexture(gl, state.scalarTexture, null, state.scalarTextureUpper)
        if (state.scalarTextureUpper) gl.deleteTexture(state.scalarTextureUpper)
        deleteTexturePair(gl, state.classifierTexture)
        if (state.colormapTextureInterpolated) gl.deleteTexture(state.colormapTextureInterpolated)
        if (state.colormapTextureBanded) gl.deleteTexture(state.colormapTextureBanded)
        if (state.vertexBuffer) gl.deleteBuffer(state.vertexBuffer)
        if (state.vao) gl.deleteVertexArray(state.vao)
        if (state.program) gl.deleteProgram(state.program)
      }

      state.map = undefined
      state.gl = undefined
      state.available = false
      state.hasFrame = false
      state.scalarTexture = null
      state.scalarTextureUpper = null
      state.scalarFrameLower = null
      state.scalarFrameUpper = null
      state.classifierTexture = null
      state.classifierMapping = emptyClassifierRowMapping()
      state.colormapRowCount = 1
      state.colormapTextureInterpolated = null
      state.colormapTextureBanded = null
      state.colormapKey = null
      state.program = null
      state.vao = null
      state.vertexBuffer = null
    },
  }
}

function findReusableScalarTexture(
  state: FieldRendererState,
  frame: FieldTimeSliceData
): WebGLTexture | null {
  if (state.scalarFrameLower === frame) return state.scalarTexture
  if (state.scalarFrameUpper === frame) return state.scalarTextureUpper
  return null
}

function deleteUnusedScalarTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
  nextLowerTexture: WebGLTexture | null,
  nextUpperTexture: WebGLTexture | null
) {
  if (!texture) return
  if (texture === nextLowerTexture || texture === nextUpperTexture) return
  gl.deleteTexture(texture)
}

function createClassifierTexturePair(
  gl: WebGL2RenderingContext,
  lowerFrame: FieldTimeSliceData,
  upperFrame: FieldTimeSliceData,
): TexturePair | null {
  const classifierOverlayId = lowerFrame.classifiedColoring?.classifierOverlayId
  if (!classifierOverlayId) return null

  const lowerOverlay = lowerFrame.overlays.find((overlay) => overlay.id === classifierOverlayId)
  const upperOverlay = upperFrame === lowerFrame
    ? lowerOverlay
    : upperFrame.overlays.find((overlay) => overlay.id === classifierOverlayId)
  if (!lowerOverlay || !upperOverlay) return null

  const lowerTexture = createOverlayTexture(gl, lowerOverlay)
  if (!lowerTexture) return null
  const upperTexture = upperOverlay === lowerOverlay
    ? lowerTexture
    : createOverlayTexture(gl, upperOverlay)
  if (!upperTexture) {
    gl.deleteTexture(lowerTexture)
    return null
  }
  return { lower: lowerTexture, upper: upperTexture }
}

function createOverlayTexture(
  gl: WebGL2RenderingContext,
  overlay: FieldTimeSliceData['overlays'][number],
): WebGLTexture | null {
  const expectedCellCount = overlay.grid.nx * overlay.grid.ny
  if (overlay.values.length !== expectedCellCount) return null
  return createScalarTexture(gl, overlay.grid.nx, overlay.grid.ny, overlay.values)
}

function deleteTexturePair(
  gl: WebGL2RenderingContext,
  texturePair: TexturePair | null
): void {
  if (!texturePair) return
  gl.deleteTexture(texturePair.lower)
  if (texturePair.upper !== texturePair.lower) {
    gl.deleteTexture(texturePair.upper)
  }
}

function bindTexturePair(
  gl: WebGL2RenderingContext,
  textureUnitOffset: number,
  texturePair: TexturePair | null,
  fallbackTexture: WebGLTexture,
  side: 'lower' | 'upper',
): void {
  gl.activeTexture(gl.TEXTURE0 + textureUnitOffset)
  gl.bindTexture(gl.TEXTURE_2D, texturePair?.[side] ?? fallbackTexture)
}

function createFrameTexture(
  gl: WebGL2RenderingContext,
  frame: FieldTimeSliceData,
): WebGLTexture | null {
  return createScalarTexture(
    gl,
    frame.grid.nx,
    frame.grid.ny,
    frame.values,
  )
}

function createScalarTexture(
  gl: WebGL2RenderingContext,
  nx: number,
  ny: number,
  values: Float32Array
): WebGLTexture | null {
  // Upload decoded scalar values; missing data is represented as NaN.
  const texture = gl.createTexture()
  if (!texture) return null

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, values)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function createColormapTexture(
  gl: WebGL2RenderingContext,
  frame: FieldTimeSliceData,
  colorSamplingMode: FieldColorSamplingMode
): WebGLTexture | null {
  // Build a row-based RGBA LUT atlas. Row 0 is the default layer palette;
  // optional classifier classes append additional rows.
  const texture = gl.createTexture()
  if (!texture) return null

  const lutSize = colorSamplingMode === 'banded'
    ? BANDED_COLORMAP_LUT_SIZE
    : COLORMAP_LUT_SIZE
  const colormapRows = colormapRowsForFrame(frame)
  const lut = buildColormapAtlasLut(
    colormapRows,
    frame.displayRange,
    lutSize,
    colorSamplingMode
  )

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  // Interpolated mode blends texels; banded mode uses threshold colors from exact texels.
  if (colorSamplingMode === 'banded') {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lutSize, colormapRows.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function createColormapKey(frame: FieldTimeSliceData): string {
  // Deterministic key for LUT texture reuse.
  return JSON.stringify({
    displayRange: frame.displayRange,
    colortable: frame.colortable,
    classifiedColoring: frame.classifiedColoring,
  })
}

function colormapRowsForFrame(frame: FieldTimeSliceData): LayerColortableStop[][] {
  return [
    frame.colortable,
    ...(frame.classifiedColoring?.classes.map((entry) => entry.colortable) ?? []),
  ]
}

export function buildColormapAtlasLut(
  colortables: readonly LayerColortableStop[][],
  displayRange: [number, number],
  size: number,
  colorSamplingMode: FieldColorSamplingMode
): Uint8Array {
  const rows = colortables.length > 0 ? colortables : [[]]
  const lut = new Uint8Array(size * rows.length * 4)

  rows.forEach((colortable, rowIndex) => {
    lut.set(
      buildColormapLut(colortable, displayRange, size, colorSamplingMode),
      rowIndex * size * 4
    )
  })

  return lut
}

export function buildClassifierRowMapping(
  classifiedColoring: FieldTimeSliceData['classifiedColoring'] | undefined
): ClassifierRowMapping {
  const mapping = emptyClassifierRowMapping()
  if (!classifiedColoring) return mapping

  for (let classIndex = 0; classIndex < classifiedColoring.classes.length; classIndex += 1) {
    const entry = classifiedColoring.classes[classIndex]
    if (!entry) continue
    const row = classIndex + 1
    for (const value of entry.values) {
      if (mapping.count >= MAX_CLASSIFIER_VALUE_MAPPINGS) return mapping
      if (!Number.isFinite(value)) continue
      mapping.values[mapping.count] = Math.round(value)
      mapping.rows[mapping.count] = row
      mapping.count += 1
    }
  }

  return mapping
}

function emptyClassifierRowMapping(): ClassifierRowMapping {
  return {
    values: new Int32Array(MAX_CLASSIFIER_VALUE_MAPPINGS),
    rows: new Int32Array(MAX_CLASSIFIER_VALUE_MAPPINGS),
    count: 0,
  }
}

export function buildColormapLut(
  colortable: LayerColortableStop[],
  displayRange: [number, number],
  size: number,
  colorSamplingMode: FieldColorSamplingMode
): Uint8Array {
  // Normalize/sanitize stops before sampling into a fixed-size LUT.
  const [rangeMin, rangeMax] = displayRange
  const normalizedStops = normalizeColortableStops(colortable, displayRange)
  const safeStops = [...normalizedStops]
    .filter((stop) => Number.isFinite(stop[0]) && Number.isFinite(stop[1]) && Number.isFinite(stop[2]) && Number.isFinite(stop[3]))
    .sort((a, b) => a[0] - b[0])
  const stops = safeStops.length > 0
    ? safeStops
    : [[rangeMin, 220, 220, 220], [rangeMax, 80, 80, 80]] as NormalizedColortableStop[]
  const span = Math.max(1e-6, rangeMax - rangeMin)
  const lut = new Uint8Array(size * 4)

  for (let idx = 0; idx < size; idx += 1) {
    const value = rangeMin + (span * idx) / Math.max(1, size - 1)
    // Interpolated mode blends stops; banded mode treats stops as lower-bound thresholds.
    const color = colorSamplingMode === 'banded'
      ? sampleColortableThreshold(stops, value)
      : sampleColortable(stops, value)
    const offset = idx * 4
    lut[offset] = color[0]
    lut[offset + 1] = color[1]
    lut[offset + 2] = color[2]
    lut[offset + 3] = 255
  }

  return lut
}

function normalizeColortableStops(
  colortable: LayerColortableStop[],
  displayRange: [number, number]
): NormalizedColortableStop[] {
  const [rangeMin, rangeMax] = displayRange
  if (colortable.length === 0) return []

  const span = rangeMax - rangeMin
  const denominator = Math.max(1, colortable.length - 1)

  return colortable.map((stop, index) => {
    // Stop format: [value, r, g, b] or [r, g, b].
    // When value is omitted, distribute stops evenly across the display range.
    if (stop.length === 4) {
      return [stop[0], stop[1], stop[2], stop[3]]
    }

    const value = rangeMin + (span * index) / denominator
    return [value, stop[0], stop[1], stop[2]]
  })
}

function sampleColortable(stops: NormalizedColortableStop[], value: number): [number, number, number] {
  // Piecewise-linear interpolation between adjacent stop pairs.
  if (stops.length === 1) {
    return [stops[0][1], stops[0][2], stops[0][3]]
  }
  if (value <= stops[0][0]) {
    return [stops[0][1], stops[0][2], stops[0][3]]
  }

  const last = stops[stops.length - 1]
  if (value >= last[0]) {
    return [last[1], last[2], last[3]]
  }

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    if (value < a[0] || value > b[0]) continue
    const span = Math.max(1e-6, b[0] - a[0])
    const t = (value - a[0]) / span
    return [
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
      Math.round(lerp(a[3], b[3], t)),
    ]
  }

  return [last[1], last[2], last[3]]
}

function sampleColortableThreshold(stops: NormalizedColortableStop[], value: number): [number, number, number] {
  // Lower-bound threshold lookup for banded mode.
  if (stops.length === 1) {
    return [stops[0][1], stops[0][2], stops[0][3]]
  }

  let selected = stops[0]

  for (let i = 1; i < stops.length; i += 1) {
    const candidate = stops[i]
    if (value < candidate[0]) break
    selected = candidate
  }

  return [selected[1], selected[2], selected[3]]
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[field] program link failed:', gl.getProgramInfoLog(program) ?? '')
    gl.deleteProgram(program)
    return null
  }

  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[field] shader compile failed:', gl.getShaderInfoLog(shader) ?? '')
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createWrappedWorldVertexBuffer(gl: WebGL2RenderingContext): WebGLBuffer | null {
  // Fullscreen unit quad; shader maps it into wrapped-world copies.
  const buffer = gl.createBuffer()
  if (!buffer) return null

  const vertices = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    0, 1,
    1, 0,
    1, 1,
  ])

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  return buffer
}

function createVao(gl: WebGL2RenderingContext, vertexBuffer: WebGLBuffer | null): WebGLVertexArrayObject | null {
  if (!vertexBuffer) return null
  const vao = gl.createVertexArray()
  if (!vao) return null

  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  return vao
}

function computeCenterWorldWrap(lng: number): number {
  // Use the wrapped copy nearest map center as the multi-copy base.
  if (!Number.isFinite(lng)) return 0
  return Math.floor((lng + 180) / 360)
}

function computeWorldSizeAtZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 512
  return 512 * (2 ** zoom)
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
