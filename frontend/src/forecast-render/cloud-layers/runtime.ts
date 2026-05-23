import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import type { CloudLayersTimeSliceData } from '../../forecast-data'
import { SCALAR_VERTEX_SHADER_SOURCE } from '../field/engine/shaders'
import { WORLD_WRAP_COPY_OFFSETS } from '../field/engine/constants'
import { asWebGL2 } from '../webgl'
import {
  registerCloudLayersController,
  unregisterCloudLayersController,
  type CloudLayersController,
} from './controller'
import { CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE } from './shaders'

type CloudLayersState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  available: boolean
  hasFrame: boolean
  program: WebGLProgram | null
  vao: WebGLVertexArrayObject | null
  vertexBuffer: WebGLBuffer | null
  lowerTexture: WebGLTexture | null
  upperTexture: WebGLTexture | null
  lowerFrame: CloudLayersTimeSliceData | null
  upperFrame: CloudLayersTimeSliceData | null
  gridNx: number
  gridNy: number
  lon0: number
  lat0: number
  dx: number
  dy: number
  scale: number
  offset: number
  timeMix: number
  uniforms: {
    cloudTex: WebGLUniformLocation | null
    cloudTexUpper: WebGLUniformLocation | null
    gridSize: WebGLUniformLocation | null
    timeMix: WebGLUniformLocation | null
    matrix: WebGLUniformLocation | null
    worldOffsetX: WebGLUniformLocation | null
    worldSize: WebGLUniformLocation | null
    lon0: WebGLUniformLocation | null
    lat0: WebGLUniformLocation | null
    dx: WebGLUniformLocation | null
    dy: WebGLUniformLocation | null
    scale: WebGLUniformLocation | null
    offset: WebGLUniformLocation | null
    zoom: WebGLUniformLocation | null
  }
}

export type CloudLayersRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput
  ) => void
  onRemove: (_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createCloudLayersRuntime(): CloudLayersRuntime {
  const state: CloudLayersState = {
    available: false,
    hasFrame: false,
    program: null,
    vao: null,
    vertexBuffer: null,
    lowerTexture: null,
    upperTexture: null,
    lowerFrame: null,
    upperFrame: null,
    gridNx: 0,
    gridNy: 0,
    lon0: 0,
    lat0: 0,
    dx: 1,
    dy: 1,
    scale: 1,
    offset: 0,
    timeMix: 0,
    uniforms: {
      cloudTex: null,
      cloudTexUpper: null,
      gridSize: null,
      timeMix: null,
      matrix: null,
      worldOffsetX: null,
      worldSize: null,
      lon0: null,
      lat0: null,
      dx: null,
      dy: null,
      scale: null,
      offset: null,
      zoom: null,
    },
  }

  const controller: CloudLayersController = {
    isAvailable: () => state.available,
    applyFrame: (frame) => {
      if (!state.available || !state.gl) throw new Error('Cloud Layers runtime unavailable')
      if (frame == null) {
        clearCloudTextures(state)
        state.hasFrame = false
        state.map?.triggerRepaint()
        return
      }

      const lowerFrame = frame.lower
      const upperFrame = frame.mix > 0 ? frame.upper : frame.lower
      validateCloudFrame(lowerFrame)
      validateCloudFrame(upperFrame)

      const previousLowerTexture = state.lowerTexture
      const previousUpperTexture = state.upperTexture
      const reusableLowerTexture = state.lowerFrame === lowerFrame ? state.lowerTexture : null
      const reusableUpperTexture = upperFrame === lowerFrame
        ? reusableLowerTexture
        : (state.upperFrame === upperFrame ? state.upperTexture : null)

      const createdLowerTexture = reusableLowerTexture
        ? null
        : createCloudTexture(state.gl, lowerFrame)
      const nextLowerTexture = reusableLowerTexture ?? createdLowerTexture
      if (!nextLowerTexture) throw new Error('Failed to create cloud layers texture')

      const createdUpperTexture = upperFrame === lowerFrame || reusableUpperTexture
        ? null
        : createCloudTexture(state.gl, upperFrame)
      const nextUpperTexture = upperFrame === lowerFrame
        ? nextLowerTexture
        : reusableUpperTexture ?? createdUpperTexture
      if (!nextUpperTexture) {
        if (createdLowerTexture) state.gl.deleteTexture(createdLowerTexture)
        throw new Error('Failed to create cloud layers texture')
      }

      deleteUnusedCloudTexture(state.gl, previousLowerTexture, nextLowerTexture, nextUpperTexture)
      deleteUnusedCloudTexture(state.gl, previousUpperTexture, nextLowerTexture, nextUpperTexture)

      state.lowerTexture = nextLowerTexture
      state.upperTexture = nextUpperTexture
      state.lowerFrame = lowerFrame
      state.upperFrame = upperFrame
      state.gridNx = lowerFrame.grid.nx
      state.gridNy = lowerFrame.grid.ny
      state.lon0 = lowerFrame.grid.lon0
      state.lat0 = lowerFrame.grid.lat0
      state.dx = lowerFrame.grid.dx
      state.dy = lowerFrame.grid.dy
      state.scale = lowerFrame.encoding.scale
      state.offset = lowerFrame.encoding.offset
      state.timeMix = upperFrame === lowerFrame ? 0 : frame.mix
      state.hasFrame = true
      state.map?.triggerRepaint()
    },
    setEnabled: (enabled) => {
      if (!enabled) {
        clearCloudTextures(state)
        state.hasFrame = false
      }
      state.map?.triggerRepaint()
    },
  }

  return {
    onAdd(map, gl) {
      state.map = map
      registerCloudLayersController(map, controller)

      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2) {
        state.available = false
        console.warn('[cloud-layers] WebGL2 is required for cloud rendering')
        return
      }

      state.gl = gl2
      state.program = createProgram(gl2, SCALAR_VERTEX_SHADER_SOURCE, CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE)
      state.vertexBuffer = createWrappedWorldVertexBuffer(gl2)
      state.vao = createVao(gl2, state.vertexBuffer)

      if (!state.program || !state.vertexBuffer || !state.vao) {
        state.available = false
        return
      }

      state.uniforms = {
        cloudTex: gl2.getUniformLocation(state.program, 'u_cloud_tex'),
        cloudTexUpper: gl2.getUniformLocation(state.program, 'u_cloud_tex_upper'),
        gridSize: gl2.getUniformLocation(state.program, 'u_grid_size'),
        timeMix: gl2.getUniformLocation(state.program, 'u_time_mix'),
        matrix: gl2.getUniformLocation(state.program, 'u_matrix'),
        worldOffsetX: gl2.getUniformLocation(state.program, 'u_world_offset_x'),
        worldSize: gl2.getUniformLocation(state.program, 'u_world_size'),
        lon0: gl2.getUniformLocation(state.program, 'u_lon0'),
        lat0: gl2.getUniformLocation(state.program, 'u_lat0'),
        dx: gl2.getUniformLocation(state.program, 'u_dx'),
        dy: gl2.getUniformLocation(state.program, 'u_dy'),
        scale: gl2.getUniformLocation(state.program, 'u_scale'),
        offset: gl2.getUniformLocation(state.program, 'u_offset'),
        zoom: gl2.getUniformLocation(state.program, 'u_zoom'),
      }

      state.available = true
    },

    render(gl, input) {
      const gl2 = asWebGL2(gl, 'createVertexArray')
      if (!gl2 || !state.available || !state.map || !state.program || !state.vao) return
      if (!state.hasFrame || !state.lowerTexture || !state.upperTexture) return

      gl2.useProgram(state.program)
      gl2.bindVertexArray(state.vao)

      gl2.activeTexture(gl2.TEXTURE0)
      gl2.bindTexture(gl2.TEXTURE_2D, state.lowerTexture)
      gl2.activeTexture(gl2.TEXTURE1)
      gl2.bindTexture(gl2.TEXTURE_2D, state.upperTexture)

      gl2.uniform1i(state.uniforms.cloudTex, 0)
      gl2.uniform1i(state.uniforms.cloudTexUpper, 1)
      gl2.uniform2f(state.uniforms.gridSize, state.gridNx, state.gridNy)
      gl2.uniform1f(state.uniforms.timeMix, state.timeMix)
      gl2.uniformMatrix4fv(state.uniforms.matrix, false, input.modelViewProjectionMatrix)
      gl2.uniform1f(state.uniforms.lon0, state.lon0)
      gl2.uniform1f(state.uniforms.lat0, state.lat0)
      gl2.uniform1f(state.uniforms.dx, state.dx)
      gl2.uniform1f(state.uniforms.dy, state.dy)
      gl2.uniform1f(state.uniforms.scale, state.scale)
      gl2.uniform1f(state.uniforms.offset, state.offset)
      const zoom = state.map.getZoom()
      gl2.uniform1f(state.uniforms.zoom, zoom)
      gl2.uniform1f(state.uniforms.worldSize, computeWorldSizeAtZoom(zoom))

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
      unregisterCloudLayersController(map)
      const { gl } = state

      if (gl) {
        clearCloudTextures(state)
        if (state.vertexBuffer) gl.deleteBuffer(state.vertexBuffer)
        if (state.vao) gl.deleteVertexArray(state.vao)
        if (state.program) gl.deleteProgram(state.program)
      }

      state.map = undefined
      state.gl = undefined
      state.available = false
      state.hasFrame = false
      state.program = null
      state.vao = null
      state.vertexBuffer = null
    },
  }
}

function validateCloudFrame(frame: CloudLayersTimeSliceData): void {
  const expectedByteCount = frame.grid.nx * frame.grid.ny * 4
  if (frame.textureBytes.length !== expectedByteCount) {
    throw new Error(`Unexpected cloud layers texture size for ${frame.artifactId}: got=${frame.textureBytes.length} expected=${expectedByteCount}`)
  }
}

function createCloudTexture(
  gl: WebGL2RenderingContext,
  frame: CloudLayersTimeSliceData
): WebGLTexture | null {
  const texture = gl.createTexture()
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
    gl.RGBA8,
    frame.grid.nx,
    frame.grid.ny,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    frame.textureBytes
  )
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function clearCloudTextures(state: CloudLayersState): void {
  if (!state.gl) return
  deleteUnusedCloudTexture(state.gl, state.lowerTexture, null, state.upperTexture)
  if (state.upperTexture) state.gl.deleteTexture(state.upperTexture)
  state.lowerTexture = null
  state.upperTexture = null
  state.lowerFrame = null
  state.upperFrame = null
}

function deleteUnusedCloudTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
  nextLowerTexture: WebGLTexture | null,
  nextUpperTexture: WebGLTexture | null
): void {
  if (!texture) return
  if (texture === nextLowerTexture || texture === nextUpperTexture) return
  gl.deleteTexture(texture)
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
    console.warn('[cloud-layers] program link failed:', gl.getProgramInfoLog(program) ?? '')
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
    console.warn('[cloud-layers] shader compile failed:', gl.getShaderInfoLog(shader) ?? '')
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
