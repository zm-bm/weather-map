import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import { worldSizeAtZoom, worldWrapForLng } from '@/core/geo'

import {
  type PressureInterpolationWindowData,
  type PressureTimeSliceData,
} from '@/forecast/data'
import { SCALAR_VERTEX_SHADER_SOURCE } from '../../field/engine/shaders'
import { WORLD_WRAP_COPY_OFFSETS } from '../../field/engine/constants'
import {
  asWebGL2,
} from '../../webgl'
import { clamp, smoothstep, wrap } from '@/core/math'
import {
  registerContourOverlayController,
  unregisterContourOverlayController,
  type ContourOverlayController,
} from '../controller'
import {
  PRESSURE_CONTOUR_HALO_ALPHA,
  PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAIN_ALPHA,
  PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS,
} from '../constants'
import { PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE } from './shaders'

type ContourOverlayState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  available: boolean
  hasFrame: boolean
  enabled: boolean
  program: WebGLProgram | null
  vao: WebGLVertexArrayObject | null
  vertexBuffer: WebGLBuffer | null
  lowerPressureTexture: WebGLTexture | null
  upperPressureTexture: WebGLTexture | null
  lowerPressureFrame: PressureTimeSliceData | null
  upperPressureFrame: PressureTimeSliceData | null
  gridNx: number
  gridNy: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  timeMix: number
  uniforms: {
    lowerPressureTex: WebGLUniformLocation | null
    upperPressureTex: WebGLUniformLocation | null
    gridSize: WebGLUniformLocation | null
    timeMix: WebGLUniformLocation | null
    matrix: WebGLUniformLocation | null
    worldOffsetX: WebGLUniformLocation | null
    worldSize: WebGLUniformLocation | null
    lon0: WebGLUniformLocation | null
    lat0: WebGLUniformLocation | null
    dx: WebGLUniformLocation | null
    dy: WebGLUniformLocation | null
  }
}

export type ContourOverlayRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput
  ) => void
  onRemove: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createContourOverlayRuntime(): ContourOverlayRuntime {
  const state: ContourOverlayState = {
    available: false,
    hasFrame: false,
    enabled: true,
    program: null,
    vao: null,
    vertexBuffer: null,
    lowerPressureTexture: null,
    upperPressureTexture: null,
    lowerPressureFrame: null,
    upperPressureFrame: null,
    gridNx: 0,
    gridNy: 0,
    lon0: 0,
    lat0: 0,
    dx: 1,
    dy: 1,
    timeMix: 0,
    uniforms: {
      lowerPressureTex: null,
      upperPressureTex: null,
      gridSize: null,
      timeMix: null,
      matrix: null,
      worldOffsetX: null,
      worldSize: null,
      lon0: null,
      lat0: null,
      dx: null,
      dy: null,
    },
  }

  const controller: ContourOverlayController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Contour overlay runtime unavailable')
      applyPressureContourFrame(state, frame)
    },
    setEnabled: (enabled) => {
      state.enabled = enabled
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerContourOverlayController(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        state.available = false
        console.warn('[contour-overlay] WebGL2 is required for pressure contours')
        return
      }

      state.gl = gl2
      state.program = createProgram(gl2, SCALAR_VERTEX_SHADER_SOURCE, PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE)
      state.vertexBuffer = createWrappedWorldVertexBuffer(gl2)
      state.vao = createVao(gl2, state.vertexBuffer)

      if (!state.program || !state.vertexBuffer || !state.vao) {
        state.available = false
        return
      }

      state.uniforms = {
        lowerPressureTex: gl2.getUniformLocation(state.program, 'u_pressure_tex_lower'),
        upperPressureTex: gl2.getUniformLocation(state.program, 'u_pressure_tex_upper'),
        gridSize: gl2.getUniformLocation(state.program, 'u_grid_size'),
        timeMix: gl2.getUniformLocation(state.program, 'u_time_mix'),
        matrix: gl2.getUniformLocation(state.program, 'u_matrix'),
        worldOffsetX: gl2.getUniformLocation(state.program, 'u_world_offset_x'),
        worldSize: gl2.getUniformLocation(state.program, 'u_world_size'),
        lon0: gl2.getUniformLocation(state.program, 'u_lon0'),
        lat0: gl2.getUniformLocation(state.program, 'u_lat0'),
        dx: gl2.getUniformLocation(state.program, 'u_dx'),
        dy: gl2.getUniformLocation(state.program, 'u_dy'),
      }

      state.available = true
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !state.available || !state.map || !state.program || !state.vao) return
      if (!state.enabled || !state.hasFrame || !state.lowerPressureTexture || !state.upperPressureTexture) return

      gl2.useProgram(state.program)
      gl2.bindVertexArray(state.vao)

      gl2.activeTexture(gl2.TEXTURE0)
      gl2.bindTexture(gl2.TEXTURE_2D, state.lowerPressureTexture)
      gl2.activeTexture(gl2.TEXTURE1)
      gl2.bindTexture(gl2.TEXTURE_2D, state.upperPressureTexture)

      gl2.uniform1i(state.uniforms.lowerPressureTex, 0)
      gl2.uniform1i(state.uniforms.upperPressureTex, 1)
      gl2.uniform2f(state.uniforms.gridSize, state.gridNx, state.gridNy)
      gl2.uniform1f(state.uniforms.timeMix, state.timeMix)
      gl2.uniformMatrix4fv(state.uniforms.matrix, false, input.modelViewProjectionMatrix)
      gl2.uniform1f(state.uniforms.lon0, state.lon0)
      gl2.uniform1f(state.uniforms.lat0, state.lat0)
      gl2.uniform1f(state.uniforms.dx, state.dx)
      gl2.uniform1f(state.uniforms.dy, state.dy)
      gl2.uniform1f(state.uniforms.worldSize, worldSizeAtZoom(state.map.getZoom()))

      gl2.disable(gl2.DEPTH_TEST)
      gl2.enable(gl2.BLEND)
      gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA)

      const centerWrap = worldWrapForLng(state.map.getCenter().lng)
      for (const relativeOffset of WORLD_WRAP_COPY_OFFSETS) {
        gl2.uniform1f(state.uniforms.worldOffsetX, centerWrap + relativeOffset)
        gl2.drawArrays(gl2.TRIANGLES, 0, 6)
      }

      gl2.disable(gl2.BLEND)
      gl2.bindVertexArray(null)
      gl2.useProgram(null)
    },

    onRemove(map) {
      unregisterContourOverlayController(map)
      const { gl } = state

      if (gl) {
        clearPressureTextures(state)
        if (state.vertexBuffer) gl.deleteBuffer(state.vertexBuffer)
        if (state.vao) gl.deleteVertexArray(state.vao)
        if (state.program) gl.deleteProgram(state.program)
      }

      state.map = undefined
      state.gl = undefined
      state.available = false
      state.hasFrame = false
      state.enabled = true
      state.lowerPressureTexture = null
      state.upperPressureTexture = null
      state.lowerPressureFrame = null
      state.upperPressureFrame = null
      state.program = null
      state.vao = null
      state.vertexBuffer = null
    },
  }
}

function applyPressureContourFrame(
  state: ContourOverlayState,
  frame: PressureInterpolationWindowData | null
): void {
  if (!state.gl) return
  if (frame == null) {
    clearPressureTextures(state)
    state.hasFrame = false
    state.map?.triggerRepaint()
    return
  }

  const { gl } = state
  const lowerFrame = frame.lower
  const upperFrame = frame.mix > 0 ? frame.upper : frame.lower
  validatePressureFrame(lowerFrame)
  validatePressureFrame(upperFrame)

  const previousLowerPressureTexture = state.lowerPressureTexture
  const previousUpperPressureTexture = state.upperPressureTexture
  const reusableLowerTexture = findReusablePressureTexture(state, lowerFrame)
  const reusableUpperTexture = upperFrame === lowerFrame
    ? reusableLowerTexture
    : findReusablePressureTexture(state, upperFrame)
  const createdLowerTexture = reusableLowerTexture
    ? null
    : createPressureTexture(gl, lowerFrame)
  const nextLowerPressureTexture = reusableLowerTexture ?? createdLowerTexture
  if (!nextLowerPressureTexture) throw new Error('Failed to create pressure contour texture')

  const createdUpperTexture = upperFrame === lowerFrame || reusableUpperTexture
    ? null
    : createPressureTexture(gl, upperFrame)
  const nextUpperPressureTexture = upperFrame === lowerFrame
    ? nextLowerPressureTexture
    : reusableUpperTexture ?? createdUpperTexture
  if (!nextUpperPressureTexture) {
    if (createdLowerTexture) gl.deleteTexture(createdLowerTexture)
    throw new Error('Failed to create pressure contour texture')
  }

  deleteUnusedPressureTexture(gl, previousLowerPressureTexture, nextLowerPressureTexture, nextUpperPressureTexture)
  deleteUnusedPressureTexture(gl, previousUpperPressureTexture, nextLowerPressureTexture, nextUpperPressureTexture)

  state.lowerPressureTexture = nextLowerPressureTexture
  state.upperPressureTexture = nextUpperPressureTexture
  state.lowerPressureFrame = lowerFrame
  state.upperPressureFrame = upperFrame
  state.gridNx = lowerFrame.grid.nx
  state.gridNy = lowerFrame.grid.ny
  state.lon0 = lowerFrame.grid.lon0
  state.lat0 = lowerFrame.grid.lat0
  state.dx = lowerFrame.grid.dx
  state.dy = lowerFrame.grid.dy
  state.timeMix = upperFrame === lowerFrame ? 0 : frame.mix
  state.hasFrame = true
  state.map?.triggerRepaint()
}

export function pressureContourPhaseDistanceHpa(pressureHpa: number): number {
  if (!Number.isFinite(pressureHpa)) return Number.NaN
  const phase = wrap(pressureHpa, PRESSURE_CONTOUR_INTERVAL_HPA)
  return Math.min(phase, PRESSURE_CONTOUR_INTERVAL_HPA - phase)
}

export function smoothPressureHpa3x3(valuesHpa: readonly number[]): number {
  const centerValue = valuesHpa[4] ?? Number.NaN
  if (!Number.isFinite(centerValue)) return Number.NaN

  let weightedPressureHpa = 0
  let totalWeight = 0
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS.forEach((weight, index) => {
    const value = valuesHpa[index] ?? Number.NaN
    if (!Number.isFinite(value)) return
    weightedPressureHpa += value * weight
    totalWeight += weight
  })

  return totalWeight > 0 ? weightedPressureHpa / totalWeight : Number.NaN
}

export function pressureContourPhaseBandAlpha(args: {
  distanceHpa: number
  pressureDerivativeHpa: number
  halfWidthPx: number
}): number {
  if (
    !Number.isFinite(args.distanceHpa) ||
    !Number.isFinite(args.pressureDerivativeHpa) ||
    !Number.isFinite(args.halfWidthPx) ||
    args.pressureDerivativeHpa <= 1e-5
  ) {
    return 0
  }

  const derivative = Math.max(args.pressureDerivativeHpa, 1e-4)
  const inner = derivative * Math.max(0, args.halfWidthPx)
  const outer = derivative * (Math.max(0, args.halfWidthPx) + 1)
  return 1 - smoothstep(inner, outer, args.distanceHpa)
}

export function pressureContourPhaseBandWeights(args: {
  pressureHpa: number
  pressureDerivativeHpa: number
}): {
  mainAlpha: number
  haloAlpha: number
} {
  const distanceHpa = pressureContourPhaseDistanceHpa(args.pressureHpa)
  const mainAlpha = pressureContourPhaseBandAlpha({
    distanceHpa,
    pressureDerivativeHpa: args.pressureDerivativeHpa,
    halfWidthPx: PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  }) * PRESSURE_CONTOUR_MAIN_ALPHA
  const haloAlpha = pressureContourPhaseBandAlpha({
    distanceHpa,
    pressureDerivativeHpa: args.pressureDerivativeHpa,
    halfWidthPx: PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  }) * PRESSURE_CONTOUR_HALO_ALPHA

  return { mainAlpha, haloAlpha }
}

export function interpolatePressureHpa(args: {
  lowerHpa: number
  upperHpa: number
  mix: number
}): number {
  const lowerFinite = Number.isFinite(args.lowerHpa)
  const upperFinite = Number.isFinite(args.upperHpa)
  if (!lowerFinite && !upperFinite) return Number.NaN
  if (!lowerFinite) return args.upperHpa
  if (!upperFinite) return args.lowerHpa
  return args.lowerHpa + ((args.upperHpa - args.lowerHpa) * clamp(args.mix, 0, 1))
}

function validatePressureFrame(frame: PressureTimeSliceData): void {
  const expectedCellCount = frame.grid.nx * frame.grid.ny
  if (frame.pressureHpa.length !== expectedCellCount) {
    throw new Error(`Unexpected pressure grid size for ${frame.artifactId}: got=${frame.pressureHpa.length} expected=${expectedCellCount}`)
  }
}

function findReusablePressureTexture(
  state: ContourOverlayState,
  frame: PressureTimeSliceData
): WebGLTexture | null {
  if (state.lowerPressureFrame === frame) return state.lowerPressureTexture
  if (state.upperPressureFrame === frame) return state.upperPressureTexture
  return null
}

function clearPressureTextures(state: ContourOverlayState): void {
  if (!state.gl) return
  deleteUnusedPressureTexture(state.gl, state.lowerPressureTexture, null, state.upperPressureTexture)
  if (state.upperPressureTexture) state.gl.deleteTexture(state.upperPressureTexture)
  state.lowerPressureTexture = null
  state.upperPressureTexture = null
  state.lowerPressureFrame = null
  state.upperPressureFrame = null
}

function deleteUnusedPressureTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
  nextLowerTexture: WebGLTexture | null,
  nextUpperTexture: WebGLTexture | null
): void {
  if (!texture) return
  if (texture === nextLowerTexture || texture === nextUpperTexture) return
  gl.deleteTexture(texture)
}

function createPressureTexture(
  gl: WebGL2RenderingContext,
  frame: PressureTimeSliceData,
): WebGLTexture | null {
  const texture = gl.createTexture()
  if (!texture) return null

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, frame.grid.nx, frame.grid.ny, 0, gl.RED, gl.FLOAT, frame.pressureHpa)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
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
    console.warn('[contour-overlay] program link failed:', gl.getProgramInfoLog(program) ?? '')
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
    console.warn('[contour-overlay] shader compile failed:', gl.getShaderInfoLog(shader) ?? '')
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
