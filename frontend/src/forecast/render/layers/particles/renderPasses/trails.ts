import * as twgl from 'twgl.js'

import { clamp } from '@/core/math'
import type { ParticleRenderSettings } from '@/forecast/settings/settings'
import { bindTrailFramebuffer } from '../trailTargets'
import type { ParticlePassState, ParticleProjectionUniforms } from './index'
import { drawParticleGeometryPass } from './particles'

export function runTrailPass(
  state: ParticlePassState,
  options: ParticleRenderSettings,
  projection: ParticleProjectionUniforms,
): WebGLTexture | null {
  const { gl, trailTargets } = state
  const {
    trailFramebuffer,
    trailTextures,
    activeTrailSourceIndex,
    trailWidth,
    trailHeight,
  } = trailTargets
  if (!gl || !trailFramebuffer || !trailTextures[0] || !trailTextures[1]) return null

  const srcTexture = trailTextures[activeTrailSourceIndex]
  const dstIndex: 0 | 1 = activeTrailSourceIndex === 0 ? 1 : 0
  const dstTexture = trailTextures[dstIndex]
  if (!srcTexture || !dstTexture) return null

  bindTrailFramebuffer(gl, trailFramebuffer, dstTexture)
  gl.viewport(0, 0, trailWidth, trailHeight)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  compositeTrailPass(state, srcTexture, options.trailFade, options.trailQuantize)
  drawParticleGeometryPass(state, options, projection)

  trailTargets.activeTrailSourceIndex = dstIndex
  return dstTexture
}

export function compositeTrailToMap(
  state: ParticlePassState,
  texture: WebGLTexture,
  options: ParticleRenderSettings,
): void {
  const { gl, trailProgramInfo } = state
  const { trailQuadBufferInfo } = state.trailTargets
  if (!gl || !trailProgramInfo || !trailQuadBufferInfo) return

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  )

  gl.useProgram(trailProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, trailProgramInfo, trailQuadBufferInfo)
  twgl.setUniforms(trailProgramInfo, {
    u_screen: texture,
    u_opacity: clamp(options.trailCompositeOpacity, 0, 1),
    u_quantize: 0,
  })
  twgl.drawBufferInfo(gl, trailQuadBufferInfo, gl.TRIANGLES)
  gl.useProgram(null)

  gl.disable(gl.BLEND)
}

function compositeTrailPass(
  state: ParticlePassState,
  texture: WebGLTexture,
  opacity: number,
  quantize: boolean,
): void {
  const { gl, trailProgramInfo } = state
  const { trailQuadBufferInfo } = state.trailTargets
  if (!gl || !trailProgramInfo || !trailQuadBufferInfo) return

  gl.useProgram(trailProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, trailProgramInfo, trailQuadBufferInfo)
  twgl.setUniforms(trailProgramInfo, {
    u_screen: texture,
    u_opacity: opacity,
    u_quantize: quantize ? 1 : 0,
  })
  twgl.drawBufferInfo(gl, trailQuadBufferInfo, gl.TRIANGLES)
  gl.useProgram(null)
}
