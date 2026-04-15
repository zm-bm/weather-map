import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import type {
  LayerColortableStop,
} from '../../manifest'
import {
  SCALAR_FRAGMENT_SHADER_SOURCE,
  SCALAR_VERTEX_SHADER_SOURCE,
} from './shaders'
import { SCALAR_ACTIVE_OPACITY } from './constants'
import {
  createControllerRegistry,
  type FrameRuntimeController,
  asWebGL2,
} from '../../shared'
import type { ScalarFrameData } from './types'
import {
  DEFAULT_SCALAR_RUNTIME_OPTIONS,
  type ScalarColorSamplingMode,
  type ScalarRuntimeOptions,
} from '../options'

export type ScalarRuntimeController = FrameRuntimeController<ScalarFrameData>

const scalarRuntimeControllers = createControllerRegistry<ScalarRuntimeController>()

export function getScalarRuntimeController(map: MapLibreMap): ScalarRuntimeController | null {
  return scalarRuntimeControllers.get(map)
}

function registerScalarRuntimeController(map: MapLibreMap, controller: ScalarRuntimeController) {
  scalarRuntimeControllers.register(map, controller)
}

function unregisterScalarRuntimeController(map: MapLibreMap) {
  scalarRuntimeControllers.unregister(map)
}

const DEFAULT_SCALAR_OPACITY = SCALAR_ACTIVE_OPACITY
const COLORMAP_LUT_SIZE = 256
const WORLD_WRAP_COPY_OFFSETS = [-2, -1, 0, 1, 2] as const
type NormalizedColortableStop = [number, number, number, number]

type ScalarLayerState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  available: boolean
  hasFrame: boolean
  opacity: number
  colorSamplingMode: ScalarColorSamplingMode
  program: WebGLProgram | null
  vao: WebGLVertexArrayObject | null
  vertexBuffer: WebGLBuffer | null
  scalarTexture: WebGLTexture | null
  colormapTextureInterpolated: WebGLTexture | null
  colormapTextureBanded: WebGLTexture | null
  colormapKey: string | null
  gridNx: number
  gridNy: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  scale: number
  offset: number
  nodata: number
  displayMin: number
  displayMax: number
  uniforms: {
    scalarTex: WebGLUniformLocation | null
    colormapTex: WebGLUniformLocation | null
    gridSize: WebGLUniformLocation | null
    displayRange: WebGLUniformLocation | null
    scale: WebGLUniformLocation | null
    offset: WebGLUniformLocation | null
    nodata: WebGLUniformLocation | null
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

export type ScalarLayerRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput
  ) => void
  onRemove: (_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createScalarRuntime(
  options: ScalarRuntimeOptions = DEFAULT_SCALAR_RUNTIME_OPTIONS
): ScalarLayerRuntime {
  const state: ScalarLayerState = {
    available: false,
    hasFrame: false,
    opacity: DEFAULT_SCALAR_OPACITY,
    colorSamplingMode: options.colorSamplingMode,
    program: null,
    vao: null,
    vertexBuffer: null,
    scalarTexture: null,
    colormapTextureInterpolated: null,
    colormapTextureBanded: null,
    colormapKey: null,
    gridNx: 0,
    gridNy: 0,
    lon0: 0,
    lat0: 0,
    dx: 1,
    dy: 1,
    scale: 1,
    offset: 0,
    nodata: -32768,
    displayMin: 0,
    displayMax: 1,
    uniforms: {
      scalarTex: null,
      colormapTex: null,
      gridSize: null,
      displayRange: null,
      scale: null,
      offset: null,
      nodata: null,
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

  const controller: ScalarRuntimeController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Scalar runtime unavailable')
      const { gl } = state
      const expectedCellCount = frame.grid.nx * frame.grid.ny
      if (frame.values.length !== expectedCellCount) {
        throw new Error(`Unexpected scalar grid size for ${frame.variableId}: got=${frame.values.length} expected=${expectedCellCount}`)
      }

      const nextScalarTexture = createScalarTexture(gl, frame.grid.nx, frame.grid.ny, frame.values)
      if (!nextScalarTexture) throw new Error('Failed to create scalar texture')

      const nextColormapKey = createColormapKey(frame.colortable, frame.displayRange)
      const shouldRebuildColormap =
        state.colormapKey !== nextColormapKey ||
        !state.colormapTextureInterpolated ||
        !state.colormapTextureBanded

      let nextColormapTextureInterpolated = state.colormapTextureInterpolated
      let nextColormapTextureBanded = state.colormapTextureBanded

      if (shouldRebuildColormap) {
        nextColormapTextureInterpolated = createColormapTexture(
          gl,
          frame.colortable,
          frame.displayRange,
          'interpolated'
        )
        if (!nextColormapTextureInterpolated) {
          gl.deleteTexture(nextScalarTexture)
          throw new Error('Failed to create scalar colormap texture')
        }

        nextColormapTextureBanded = createColormapTexture(
          gl,
          frame.colortable,
          frame.displayRange,
          'banded'
        )
        if (!nextColormapTextureBanded) {
          gl.deleteTexture(nextScalarTexture)
          gl.deleteTexture(nextColormapTextureInterpolated)
          throw new Error('Failed to create scalar colormap texture')
        }
      }

      if (state.scalarTexture) gl.deleteTexture(state.scalarTexture)
      if (shouldRebuildColormap) {
        if (state.colormapTextureInterpolated) gl.deleteTexture(state.colormapTextureInterpolated)
        if (state.colormapTextureBanded) gl.deleteTexture(state.colormapTextureBanded)
      }

      state.scalarTexture = nextScalarTexture
      if (shouldRebuildColormap) {
        state.colormapTextureInterpolated = nextColormapTextureInterpolated
        state.colormapTextureBanded = nextColormapTextureBanded
        state.colormapKey = nextColormapKey
      }
      state.gridNx = frame.grid.nx
      state.gridNy = frame.grid.ny
      state.lon0 = frame.grid.lon0
      state.lat0 = frame.grid.lat0
      state.dx = frame.grid.dx
      state.dy = frame.grid.dy
      state.scale = frame.encoding.scale
      state.offset = frame.encoding.offset
      state.nodata = frame.encoding.nodata
      state.displayMin = frame.displayRange[0]
      state.displayMax = frame.displayRange[1]
      state.colorSamplingMode = options.colorSamplingMode
      state.hasFrame = true
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerScalarRuntimeController(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        state.available = false
        console.warn('[scalar] WebGL2 is required for scalar rendering')
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
        colormapTex: gl2.getUniformLocation(state.program, 'u_colormap_tex'),
        gridSize: gl2.getUniformLocation(state.program, 'u_grid_size'),
        displayRange: gl2.getUniformLocation(state.program, 'u_display_range'),
        scale: gl2.getUniformLocation(state.program, 'u_scale'),
        offset: gl2.getUniformLocation(state.program, 'u_offset'),
        nodata: gl2.getUniformLocation(state.program, 'u_nodata'),
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
      if (!state.scalarTexture || !state.hasFrame || state.opacity <= 0) return

      state.colorSamplingMode = options.colorSamplingMode
      const colormapTexture = state.colorSamplingMode === 'banded'
        ? state.colormapTextureBanded
        : state.colormapTextureInterpolated
      if (!colormapTexture) return

      gl2.useProgram(state.program)
      gl2.bindVertexArray(state.vao)

      gl2.activeTexture(gl2.TEXTURE0)
      gl2.bindTexture(gl2.TEXTURE_2D, state.scalarTexture)
      gl2.activeTexture(gl2.TEXTURE1)
      gl2.bindTexture(gl2.TEXTURE_2D, colormapTexture)

      gl2.uniform1i(state.uniforms.scalarTex, 0)
      gl2.uniform1i(state.uniforms.colormapTex, 1)
      gl2.uniform2f(state.uniforms.gridSize, state.gridNx, state.gridNy)
      gl2.uniform2f(state.uniforms.displayRange, state.displayMin, state.displayMax)
      gl2.uniform1f(state.uniforms.scale, state.scale)
      gl2.uniform1f(state.uniforms.offset, state.offset)
      gl2.uniform1i(state.uniforms.nodata, state.nodata)
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
      unregisterScalarRuntimeController(map)
      const { gl } = state

      if (gl) {
        if (state.scalarTexture) gl.deleteTexture(state.scalarTexture)
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
      state.colormapTextureInterpolated = null
      state.colormapTextureBanded = null
      state.colormapKey = null
      state.program = null
      state.vao = null
      state.vertexBuffer = null
    },
  }
}

function createScalarTexture(
  gl: WebGL2RenderingContext,
  nx: number,
  ny: number,
  values: Int16Array
): WebGLTexture | null {
  const texture = gl.createTexture()
  if (!texture) return null

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, nx, ny, 0, gl.RED_INTEGER, gl.SHORT, values)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function createColormapTexture(
  gl: WebGL2RenderingContext,
  colortable: LayerColortableStop[],
  displayRange: [number, number],
  colorSamplingMode: ScalarColorSamplingMode
): WebGLTexture | null {
  const texture = gl.createTexture()
  if (!texture) return null

  const lut = buildColormapLut(colortable, displayRange, COLORMAP_LUT_SIZE, colorSamplingMode)

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  if (colorSamplingMode === 'banded') {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, COLORMAP_LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function createColormapKey(
  colortable: LayerColortableStop[],
  displayRange: [number, number]
): string {
  return JSON.stringify({
    displayRange,
    colortable,
  })
}

function buildColormapLut(
  colortable: LayerColortableStop[],
  displayRange: [number, number],
  size: number,
  colorSamplingMode: ScalarColorSamplingMode
): Uint8Array {
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
    const color = colorSamplingMode === 'banded'
      ? sampleColortableNearest(stops, value)
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
    if (stop.length === 4) {
      return [stop[0], stop[1], stop[2], stop[3]]
    }

    const value = rangeMin + (span * index) / denominator
    return [value, stop[0], stop[1], stop[2]]
  })
}

function sampleColortable(stops: NormalizedColortableStop[], value: number): [number, number, number] {
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

function sampleColortableNearest(stops: NormalizedColortableStop[], value: number): [number, number, number] {
  if (stops.length === 1) {
    return [stops[0][1], stops[0][2], stops[0][3]]
  }

  let nearest = stops[0]
  let bestDistance = Math.abs(value - nearest[0])

  for (let i = 1; i < stops.length; i += 1) {
    const candidate = stops[i]
    const distance = Math.abs(value - candidate[0])
    if (distance < bestDistance) {
      nearest = candidate
      bestDistance = distance
    }
  }

  return [nearest[1], nearest[2], nearest[3]]
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
    console.warn('[scalar] program link failed:', gl.getProgramInfoLog(program) ?? '')
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
    console.warn('[scalar] shader compile failed:', gl.getShaderInfoLog(shader) ?? '')
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createWrappedWorldVertexBuffer(gl: WebGL2RenderingContext): WebGLBuffer | null {
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
