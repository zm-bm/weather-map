import type { ContourWindow } from '@/forecast/frames'
import {
  encodedGridUniforms,
  encodedLinearUniforms,
  type EncodedFramePair,
} from '../../../encodedGrid'
import {
  bindWrappedWorldQuad,
  createProgramInfo,
  drawWrappedWorldQuad,
  setUniforms,
  type ProgramInfo,
  type WrappedWorldQuad,
} from '../../../gpu'
import {
  PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE,
  PRESSURE_SMOOTHING_VERTEX_SHADER_SOURCE,
} from '../shaders'
import type { PressureEncodingRenderSpec } from './pressure'

type ContourWindowFrame = ContourWindow['lower']

class SmoothedPressureTextureCache {
  private readonly entries = new Map<string, WebGLTexture>()
  private readonly limit: number

  constructor(limit = 12) {
    this.limit = limit
  }

  get(key: string): WebGLTexture | null {
    const existing = this.entries.get(key)
    if (!existing) return null
    this.entries.delete(key)
    this.entries.set(key, existing)
    return existing
  }

  set(gl: WebGL2RenderingContext, key: string, texture: WebGLTexture): void {
    this.entries.set(key, texture)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest == null) return
      const oldestTexture = this.entries.get(oldest)
      this.entries.delete(oldest)
      if (oldestTexture) gl.deleteTexture(oldestTexture)
    }
  }

  clear(gl: WebGL2RenderingContext): void {
    for (const texture of this.entries.values()) {
      gl.deleteTexture(texture)
    }
    this.entries.clear()
  }
}

export type PressurePrefilter = {
  programInfo: ProgramInfo
  framebuffer: WebGLFramebuffer
  textureCache: SmoothedPressureTextureCache
  available: boolean
}

export function createPressurePrefilter(gl: WebGL2RenderingContext): PressurePrefilter | null {
  if (!gl.getExtension('EXT_color_buffer_float')) return null

  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) return null

  const programInfo = createProgramInfo({
    gl,
    label: 'contour-smoothing',
    vertexSource: PRESSURE_SMOOTHING_VERTEX_SHADER_SOURCE,
    fragmentSource: PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE,
  })
  if (!programInfo) {
    gl.deleteFramebuffer(framebuffer)
    return null
  }

  return {
    programInfo,
    framebuffer,
    textureCache: new SmoothedPressureTextureCache(),
    available: true,
  }
}

export function createSmoothedPressureFramePair(args: {
  gl: WebGL2RenderingContext
  prefilter: PressurePrefilter | null
  quad: WrappedWorldQuad | null
  rawFramePair: EncodedFramePair<ContourWindowFrame>
  renderSpec: PressureEncodingRenderSpec
}): EncodedFramePair<ContourWindowFrame> | null {
  const { gl, prefilter, quad, rawFramePair, renderSpec } = args
  if (!prefilter || !quad) return null

  const smoothTexture = (frame: ContourWindowFrame, rawTexture: WebGLTexture) => (
    createSmoothedPressureTexture({
      gl,
      prefilter,
      quad,
      frame,
      rawTexture,
      renderSpec,
    })
  )

  const lowerTexture = smoothTexture(rawFramePair.lowerFrame, rawFramePair.lowerTexture)
  const upperTexture = rawFramePair.upperFrame === rawFramePair.lowerFrame
    ? lowerTexture
    : smoothTexture(rawFramePair.upperFrame, rawFramePair.upperTexture)
  if (!lowerTexture || !upperTexture) return null

  return {
    lowerFrame: rawFramePair.lowerFrame,
    upperFrame: rawFramePair.upperFrame,
    grid: rawFramePair.grid,
    lowerTexture,
    upperTexture,
    timeMix: rawFramePair.timeMix,
  }
}

function createSmoothedPressureTexture(args: {
  gl: WebGL2RenderingContext
  prefilter: PressurePrefilter
  quad: WrappedWorldQuad
  frame: ContourWindowFrame
  rawTexture: WebGLTexture
  renderSpec: PressureEncodingRenderSpec
}): WebGLTexture | null {
  const { gl, prefilter, frame, rawTexture, renderSpec } = args
  if (!prefilter.available) return null

  const existing = prefilter.textureCache.get(frame.raster.cacheKey)
  if (existing) return existing

  const texture = createPressureRenderTargetTexture(gl, frame)
  if (!texture) return null

  const didRender = renderSmoothedPressureTexture({
    gl,
    prefilter,
    quad: args.quad,
    frame,
    rawTexture,
    smoothedTexture: texture,
    renderSpec,
  })
  if (!didRender) {
    gl.deleteTexture(texture)
    return null
  }

  prefilter.textureCache.set(gl, frame.raster.cacheKey, texture)
  return texture
}

export function disposePressurePrefilter(
  gl: WebGL2RenderingContext,
  prefilter: PressurePrefilter
): void {
  prefilter.textureCache.clear(gl)
  gl.deleteFramebuffer(prefilter.framebuffer)
  gl.deleteProgram(prefilter.programInfo.program)
  prefilter.available = false
}

function createPressureRenderTargetTexture(
  gl: WebGL2RenderingContext,
  frame: ContourWindowFrame,
): WebGLTexture | null {
  const texture = gl.createTexture()
  if (!texture) return null

  try {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      frame.raster.grid.nx,
      frame.raster.grid.ny,
      0,
      gl.RED,
      gl.FLOAT,
      null
    )
    gl.bindTexture(gl.TEXTURE_2D, null)
    return texture
  } catch (error) {
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteTexture(texture)
    console.warn('[contour] failed to create smoothed pressure texture:', error)
    return null
  }
}

function renderSmoothedPressureTexture(args: {
  gl: WebGL2RenderingContext
  prefilter: PressurePrefilter
  quad: WrappedWorldQuad
  frame: ContourWindowFrame
  rawTexture: WebGLTexture
  smoothedTexture: WebGLTexture
  renderSpec: PressureEncodingRenderSpec
}): boolean {
  const {
    gl,
    prefilter,
    quad,
    frame,
    rawTexture,
    smoothedTexture,
    renderSpec,
  } = args

  gl.bindFramebuffer(gl.FRAMEBUFFER, prefilter.framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, smoothedTexture, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    prefilter.available = false
    console.warn('[contour] smoothed pressure framebuffer is incomplete; using raw fallback')
    return false
  }

  gl.viewport(0, 0, frame.raster.grid.nx, frame.raster.grid.ny)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  gl.useProgram(prefilter.programInfo.program)
  bindWrappedWorldQuad(gl, prefilter.programInfo, quad)
  setUniforms(prefilter.programInfo, {
    u_encoded_tex: rawTexture,
    ...encodedGridUniforms(frame.raster.grid),
    ...encodedLinearUniforms(renderSpec),
  })
  drawWrappedWorldQuad(gl, quad)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.useProgram(null)
  return true
}
