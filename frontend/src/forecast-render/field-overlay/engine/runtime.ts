import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import { worldSizeAtZoom, worldWrapForLng } from '../../../geo'

import {
  asWebGL2,
} from '../../webgl'
import { clamp, smoothstep } from '../../../math'
import { SCALAR_VERTEX_SHADER_SOURCE } from '../../field/engine/shaders'
import { WORLD_WRAP_COPY_OFFSETS } from '../../field/engine/constants'
import {
  registerFieldOverlayController,
  unregisterFieldOverlayController,
  type FieldOverlayController,
} from '../controller'
import type {
  PrecipTypeTimeSliceData,
} from '../../../forecast-data'
import {
  FIELD_OVERLAY_LATTICE_VISIBILITY_MAX,
  FIELD_OVERLAY_LATTICE_VISIBILITY_MIN,
  FIELD_OVERLAY_MASK_MAX,
  FIELD_OVERLAY_MASK_MIN,
  FIELD_OVERLAY_MIX_ALPHA,
  FIELD_OVERLAY_SNOW_ALPHA,
} from './constants'
import { FIELD_OVERLAY_FRAGMENT_SHADER_SOURCE } from './shaders'

export const FIELD_OVERLAY_PATTERN_FADE_OUT_MS = 80
export const FIELD_OVERLAY_PATTERN_FADE_IN_MS = 180

type OverlayFrameTextures = {
  snow: WebGLTexture
  mix: WebGLTexture
}

type FieldOverlayState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  available: boolean
  hasFrame: boolean
  program: WebGLProgram | null
  vao: WebGLVertexArrayObject | null
  vertexBuffer: WebGLBuffer | null
  lowerTextures: OverlayFrameTextures | null
  upperTextures: OverlayFrameTextures | null
  gridNx: number
  gridNy: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  timeMix: number
  patternOpacity: number
  patternOpacityTarget: number
  lastPatternOpacityMs: number | null
  uniforms: {
    snowTex: WebGLUniformLocation | null
    snowTexUpper: WebGLUniformLocation | null
    mixTex: WebGLUniformLocation | null
    mixTexUpper: WebGLUniformLocation | null
    gridSize: WebGLUniformLocation | null
    timeMix: WebGLUniformLocation | null
    matrix: WebGLUniformLocation | null
    worldOffsetX: WebGLUniformLocation | null
    worldSize: WebGLUniformLocation | null
    patternOpacity: WebGLUniformLocation | null
    lon0: WebGLUniformLocation | null
    lat0: WebGLUniformLocation | null
    dx: WebGLUniformLocation | null
    dy: WebGLUniformLocation | null
  }
}

export type FieldOverlayRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput
  ) => void
  onRemove: (_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createFieldOverlayRuntime(): FieldOverlayRuntime {
  const state: FieldOverlayState = {
    available: false,
    hasFrame: false,
    program: null,
    vao: null,
    vertexBuffer: null,
    lowerTextures: null,
    upperTextures: null,
    gridNx: 0,
    gridNy: 0,
    lon0: 0,
    lat0: 0,
    dx: 1,
    dy: 1,
    timeMix: 0,
    patternOpacity: 1,
    patternOpacityTarget: 1,
    lastPatternOpacityMs: null,
    uniforms: {
      snowTex: null,
      snowTexUpper: null,
      mixTex: null,
      mixTexUpper: null,
      gridSize: null,
      timeMix: null,
      matrix: null,
      worldOffsetX: null,
      worldSize: null,
      patternOpacity: null,
      lon0: null,
      lat0: null,
      dx: null,
      dy: null,
    },
  }

  const handleZoomStart = () => {
    setPatternOpacityTarget(state, 0)
  }
  const handleZoom = () => {
    setPatternOpacityTarget(state, 0)
  }
  const handleZoomEnd = () => {
    setPatternOpacityTarget(state, 1)
  }

  const controller: FieldOverlayController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Field overlay runtime unavailable')
      clearOverlayTextures(state)

      if (frame == null) {
        state.hasFrame = false
        state.map?.triggerRepaint()
        return
      }

      const lowerFrame = frame.lower
      const upperFrame = frame.mix > 0 ? frame.upper : frame.lower
      validateOverlayFrame(lowerFrame)
      validateOverlayFrame(upperFrame)

      const lowerTextures = createOverlayFrameTextures(state.gl, lowerFrame)
      const upperTextures = upperFrame === lowerFrame
        ? lowerTextures
        : createOverlayFrameTextures(state.gl, upperFrame)

      if (!lowerTextures || !upperTextures) {
        deleteOverlayTextures(state.gl, lowerTextures)
        deleteOverlayTextures(state.gl, upperTextures === lowerTextures ? null : upperTextures)
        throw new Error('Failed to create field overlay textures')
      }

      state.lowerTextures = lowerTextures
      state.upperTextures = upperTextures
      state.gridNx = lowerFrame.grid.nx
      state.gridNy = lowerFrame.grid.ny
      state.lon0 = lowerFrame.grid.lon0
      state.lat0 = lowerFrame.grid.lat0
      state.dx = lowerFrame.grid.dx
      state.dy = lowerFrame.grid.dy
      state.timeMix = upperFrame === lowerFrame ? 0 : frame.mix
      state.hasFrame = true
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      if (!enabled) {
        clearOverlayTextures(state)
        state.hasFrame = false
      }
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerFieldOverlayController(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        state.available = false
        console.warn('[field-overlay] WebGL2 is required for precipitation overlays')
        return
      }

      state.gl = gl2
      state.program = createProgram(gl2, SCALAR_VERTEX_SHADER_SOURCE, FIELD_OVERLAY_FRAGMENT_SHADER_SOURCE)
      state.vertexBuffer = createWrappedWorldVertexBuffer(gl2)
      state.vao = createVao(gl2, state.vertexBuffer)

      if (!state.program || !state.vertexBuffer || !state.vao) {
        state.available = false
        return
      }

      state.uniforms = {
        snowTex: gl2.getUniformLocation(state.program, 'u_snow_tex'),
        snowTexUpper: gl2.getUniformLocation(state.program, 'u_snow_tex_upper'),
        mixTex: gl2.getUniformLocation(state.program, 'u_mix_tex'),
        mixTexUpper: gl2.getUniformLocation(state.program, 'u_mix_tex_upper'),
        gridSize: gl2.getUniformLocation(state.program, 'u_grid_size'),
        timeMix: gl2.getUniformLocation(state.program, 'u_time_mix'),
        matrix: gl2.getUniformLocation(state.program, 'u_matrix'),
        worldOffsetX: gl2.getUniformLocation(state.program, 'u_world_offset_x'),
        worldSize: gl2.getUniformLocation(state.program, 'u_world_size'),
        patternOpacity: gl2.getUniformLocation(state.program, 'u_pattern_opacity'),
        lon0: gl2.getUniformLocation(state.program, 'u_lon0'),
        lat0: gl2.getUniformLocation(state.program, 'u_lat0'),
        dx: gl2.getUniformLocation(state.program, 'u_dx'),
        dy: gl2.getUniformLocation(state.program, 'u_dy'),
      }

      state.available = true
      map.on('zoomstart', handleZoomStart)
      map.on('zoom', handleZoom)
      map.on('zoomend', handleZoomEnd)
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !state.available || !state.map || !state.program || !state.vao) return
      if (!state.hasFrame || !state.lowerTextures || !state.upperTextures) return
      const opacityStep = stepPatternOpacity({
        opacity: state.patternOpacity,
        target: state.patternOpacityTarget,
        elapsedMs: elapsedPatternOpacityMs(state),
      })
      state.patternOpacity = opacityStep.opacity
      state.lastPatternOpacityMs = readPerformanceNow()

      gl2.useProgram(state.program)
      gl2.bindVertexArray(state.vao)

      gl2.activeTexture(gl2.TEXTURE0)
      gl2.bindTexture(gl2.TEXTURE_2D, state.lowerTextures.snow)
      gl2.activeTexture(gl2.TEXTURE1)
      gl2.bindTexture(gl2.TEXTURE_2D, state.upperTextures.snow)
      gl2.activeTexture(gl2.TEXTURE2)
      gl2.bindTexture(gl2.TEXTURE_2D, state.lowerTextures.mix)
      gl2.activeTexture(gl2.TEXTURE3)
      gl2.bindTexture(gl2.TEXTURE_2D, state.upperTextures.mix)

      gl2.uniform1i(state.uniforms.snowTex, 0)
      gl2.uniform1i(state.uniforms.snowTexUpper, 1)
      gl2.uniform1i(state.uniforms.mixTex, 2)
      gl2.uniform1i(state.uniforms.mixTexUpper, 3)
      gl2.uniform2f(state.uniforms.gridSize, state.gridNx, state.gridNy)
      gl2.uniform1f(state.uniforms.timeMix, state.timeMix)
      gl2.uniformMatrix4fv(state.uniforms.matrix, false, input.modelViewProjectionMatrix)
      gl2.uniform1f(state.uniforms.lon0, state.lon0)
      gl2.uniform1f(state.uniforms.lat0, state.lat0)
      gl2.uniform1f(state.uniforms.dx, state.dx)
      gl2.uniform1f(state.uniforms.dy, state.dy)
      gl2.uniform1f(state.uniforms.worldSize, worldSizeAtZoom(state.map.getZoom()))
      gl2.uniform1f(state.uniforms.patternOpacity, state.patternOpacity)

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
      if (opacityStep.needsRepaint) {
        state.map.triggerRepaint()
      }
    },

    onRemove(map) {
      unregisterFieldOverlayController(map)
      map.off('zoomstart', handleZoomStart)
      map.off('zoom', handleZoom)
      map.off('zoomend', handleZoomEnd)
      const { gl } = state

      if (gl) {
        clearOverlayTextures(state)
        if (state.vertexBuffer) gl.deleteBuffer(state.vertexBuffer)
        if (state.vao) gl.deleteVertexArray(state.vao)
        if (state.program) gl.deleteProgram(state.program)
      }

      state.map = undefined
      state.gl = undefined
      state.available = false
      state.hasFrame = false
      state.patternOpacity = 1
      state.patternOpacityTarget = 1
      state.lastPatternOpacityMs = null
      state.program = null
      state.vao = null
      state.vertexBuffer = null
    },
  }
}

export function stepPatternOpacity(args: {
  opacity: number
  target: number
  elapsedMs: number
}): {
  opacity: number
  needsRepaint: boolean
} {
  const opacity = finiteFraction(args.opacity)
  const target = finiteFraction(args.target)
  if (Math.abs(opacity - target) <= 0.001) {
    return { opacity: target, needsRepaint: false }
  }

  const elapsedMs = Math.max(0, Number.isFinite(args.elapsedMs) ? args.elapsedMs : 0)
  const durationMs = target < opacity
    ? FIELD_OVERLAY_PATTERN_FADE_OUT_MS
    : FIELD_OVERLAY_PATTERN_FADE_IN_MS
  const maxStep = durationMs <= 0 ? 1 : elapsedMs / durationMs
  const delta = clamp(target - opacity, -maxStep, maxStep)
  const nextOpacity = finiteFraction(opacity + delta)

  return {
    opacity: nextOpacity,
    needsRepaint: Math.abs(nextOpacity - target) > 0.001,
  }
}

export function precipTypeOverlayPatternWeights(args: {
  snowFrac: number
  mixFrac: number
}): {
  snowMask: number
  mixMask: number
  snowLatticeVisibility: number
  mixLatticeVisibility: number
  snowAlphaWeight: number
  mixAlphaWeight: number
} {
  const snowFrac = finiteFraction(args.snowFrac)
  const mixFrac = finiteFraction(args.mixFrac)
  const mixMask = smoothstep(FIELD_OVERLAY_MASK_MIN, FIELD_OVERLAY_MASK_MAX, mixFrac)
  const snowMask = smoothstep(FIELD_OVERLAY_MASK_MIN, FIELD_OVERLAY_MASK_MAX, snowFrac) * (1 - mixMask)
  const snowLatticeVisibility = smoothstep(
    FIELD_OVERLAY_LATTICE_VISIBILITY_MIN,
    FIELD_OVERLAY_LATTICE_VISIBILITY_MAX,
    snowFrac
  ) * snowMask
  const mixLatticeVisibility = smoothstep(
    FIELD_OVERLAY_LATTICE_VISIBILITY_MIN,
    FIELD_OVERLAY_LATTICE_VISIBILITY_MAX,
    mixFrac
  ) * mixMask
  return {
    snowMask,
    mixMask,
    snowLatticeVisibility,
    mixLatticeVisibility,
    snowAlphaWeight: snowMask * FIELD_OVERLAY_SNOW_ALPHA,
    mixAlphaWeight: mixMask * FIELD_OVERLAY_MIX_ALPHA,
  }
}

function clearOverlayTextures(state: FieldOverlayState): void {
  if (!state.gl) return
  deleteOverlayTextures(state.gl, state.lowerTextures)
  deleteOverlayTextures(
    state.gl,
    state.upperTextures === state.lowerTextures ? null : state.upperTextures
  )
  state.lowerTextures = null
  state.upperTextures = null
}

function deleteOverlayTextures(
  gl: WebGL2RenderingContext,
  textures: OverlayFrameTextures | null
): void {
  if (!textures) return
  gl.deleteTexture(textures.snow)
  gl.deleteTexture(textures.mix)
}

function validateOverlayFrame(frame: PrecipTypeTimeSliceData): void {
  const expectedCellCount = frame.grid.nx * frame.grid.ny
  if (frame.snowFrac.length !== expectedCellCount) {
    throw new Error(`Unexpected snow_frac grid size for ${frame.artifactId}: got=${frame.snowFrac.length} expected=${expectedCellCount}`)
  }
  if (frame.mixFrac.length !== expectedCellCount) {
    throw new Error(`Unexpected mix_frac grid size for ${frame.artifactId}: got=${frame.mixFrac.length} expected=${expectedCellCount}`)
  }
}

function createOverlayFrameTextures(
  gl: WebGL2RenderingContext,
  frame: PrecipTypeTimeSliceData
): OverlayFrameTextures | null {
  const snow = createComponentTexture(gl, frame.grid.nx, frame.grid.ny, frame.snowFrac)
  const mix = createComponentTexture(gl, frame.grid.nx, frame.grid.ny, frame.mixFrac)
  if (!snow || !mix) {
    if (snow) gl.deleteTexture(snow)
    if (mix) gl.deleteTexture(mix)
    return null
  }
  return { snow, mix }
}

function createComponentTexture(
  gl: WebGL2RenderingContext,
  nx: number,
  ny: number,
  values: Float32Array
): WebGLTexture | null {
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
    console.warn('[field-overlay] program link failed:', gl.getProgramInfoLog(program) ?? '')
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
    console.warn('[field-overlay] shader compile failed:', gl.getShaderInfoLog(shader) ?? '')
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

function setPatternOpacityTarget(state: FieldOverlayState, target: number): void {
  const nextTarget = finiteFraction(target)
  if (Math.abs(state.patternOpacityTarget - nextTarget) <= 0.001) return
  state.patternOpacityTarget = nextTarget
  state.lastPatternOpacityMs = readPerformanceNow()
  state.map?.triggerRepaint()
}

function elapsedPatternOpacityMs(state: FieldOverlayState): number {
  const now = readPerformanceNow()
  return state.lastPatternOpacityMs == null ? 0 : now - state.lastPatternOpacityMs
}

function readPerformanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function finiteFraction(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}
