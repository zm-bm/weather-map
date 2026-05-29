import * as twgl from 'twgl.js'

import { clamp } from '@/core/math'
import type { ParticleRenderSettings } from '@/forecast/settings/settings'

export type ParticleTrailTargets = {
  trailQuadBufferInfo: twgl.BufferInfo | null
  trailTextures: [WebGLTexture | null, WebGLTexture | null]
  activeTrailSourceIndex: 0 | 1
  trailFramebuffer: WebGLFramebuffer | null
  trailWidth: number
  trailHeight: number
}

export function createEmptyParticleTrailTargets(): ParticleTrailTargets {
  return {
    trailQuadBufferInfo: null,
    trailTextures: [null, null],
    activeTrailSourceIndex: 0,
    trailFramebuffer: null,
    trailWidth: 0,
    trailHeight: 0,
  }
}

export function initializeTrailTargets(gl: WebGL2RenderingContext, targets: ParticleTrailTargets): boolean {
  targets.trailQuadBufferInfo = createTrailQuadBufferInfo(gl)
  if (!targets.trailQuadBufferInfo) return false

  targets.trailFramebuffer = gl.createFramebuffer()
  return targets.trailFramebuffer != null
}

export function ensureTrailTargets(
  gl: WebGL2RenderingContext,
  targets: ParticleTrailTargets,
  options: ParticleRenderSettings,
): boolean {
  if (!targets.trailFramebuffer) return false

  const scale = clamp(
    Number.isFinite(options.trailScale) ? options.trailScale : 1,
    0.1,
    1,
  )
  const width = Math.max(1, Math.floor(gl.drawingBufferWidth * scale))
  const height = Math.max(1, Math.floor(gl.drawingBufferHeight * scale))

  const sizeUnchanged = width === targets.trailWidth && height === targets.trailHeight
  if (sizeUnchanged && targets.trailTextures[0] && targets.trailTextures[1]) {
    return true
  }

  if (targets.trailTextures[0]) gl.deleteTexture(targets.trailTextures[0])
  if (targets.trailTextures[1]) gl.deleteTexture(targets.trailTextures[1])

  const next0 = createTrailTexture(gl, width, height)
  const next1 = createTrailTexture(gl, width, height)
  if (!next0 || !next1) {
    targets.trailTextures = [null, null]
    targets.trailWidth = 0
    targets.trailHeight = 0
    return false
  }

  targets.trailTextures = [next0, next1]
  targets.trailWidth = width
  targets.trailHeight = height
  targets.activeTrailSourceIndex = 0
  clearTrailTextures(gl, targets)
  return true
}

export function clearTrailTextures(gl: WebGL2RenderingContext, targets: ParticleTrailTargets): void {
  const { trailFramebuffer, trailTextures, trailWidth, trailHeight } = targets
  if (!trailFramebuffer || !trailTextures[0] || !trailTextures[1]) return

  const clearColor = new Float32Array([0, 0, 0, 0])
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)
  gl.viewport(0, 0, trailWidth, trailHeight)
  bindTrailFramebuffer(gl, trailFramebuffer, trailTextures[0])
  gl.clearBufferfv(gl.COLOR, 0, clearColor)
  bindTrailFramebuffer(gl, trailFramebuffer, trailTextures[1])
  gl.clearBufferfv(gl.COLOR, 0, clearColor)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
}

export function disposeTrailTargets(gl: WebGL2RenderingContext, targets: ParticleTrailTargets): void {
  if (targets.trailQuadBufferInfo) {
    const buffer = getTrailQuadBufferFromInfo(targets.trailQuadBufferInfo)
    if (buffer) gl.deleteBuffer(buffer)
  }
  if (targets.trailTextures[0]) gl.deleteTexture(targets.trailTextures[0])
  if (targets.trailTextures[1]) gl.deleteTexture(targets.trailTextures[1])
  if (targets.trailFramebuffer) gl.deleteFramebuffer(targets.trailFramebuffer)

  Object.assign(targets, createEmptyParticleTrailTargets())
}

export function bindTrailFramebuffer(
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  texture: WebGLTexture,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
}

export function createTrailQuadBufferInfo(gl: WebGL2RenderingContext) {
  return twgl.createBufferInfoFromArrays(gl, {
    a_pos: {
      numComponents: 2,
      data: new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        0, 1,
        1, 0,
        1, 1,
      ]),
    },
  })
}

export function getTrailQuadBufferFromInfo(bufferInfo: twgl.BufferInfo) {
  const attrib = bufferInfo.attribs?.a_pos
  return attrib?.buffer ?? null
}

function createTrailTexture(gl: WebGL2RenderingContext, width: number, height: number) {
  try {
    return twgl.createTexture(gl, {
      src: new Uint8Array(width * height * 4),
      width,
      height,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      unpackAlignment: 1,
      auto: false,
    })
  } catch (error) {
    console.warn('[particles] failed to create trail texture:', error)
    return null
  }
}
