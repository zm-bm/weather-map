import * as twgl from 'twgl.js'

import type { ParticleRenderSettings } from '@/forecast/settings/settings'
import type { ParticlePassState, ParticleProjectionUniforms } from './index'

const MIN_PARTICLE_PIXEL_RATIO = 1
const MAX_PARTICLE_PIXEL_RATIO = 3

export function runParticlePass(
  state: ParticlePassState,
  options: ParticleRenderSettings,
  projection: ParticleProjectionUniforms,
): void {
  const { gl } = state
  if (!gl) return

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  drawParticleGeometryPass(state, options, projection)
}

export function drawParticleGeometryPass(
  state: ParticlePassState,
  options: ParticleRenderSettings,
  projection: ParticleProjectionUniforms,
): void {
  const {
    gl,
    viewport,
    particleProgramInfo,
    particleState,
    activeSourceIndex,
    particleCount,
  } = state
  if (
    !gl ||
    !viewport ||
    !particleProgramInfo ||
    !particleState
  ) {
    return
  }

  const particleBufferInfo = particleState.bufferInfos[activeSourceIndex]
  const pixelRatio = particleRenderPixelRatio(gl)
  const dotMinPx = options.dotMinPx * pixelRatio
  const dotMaxPx = options.dotMaxPx * pixelRatio

  gl.useProgram(particleProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, particleProgramInfo, particleBufferInfo)
  twgl.setUniforms(particleProgramInfo, {
    u_bounds_west: viewport.west,
    u_matrix: projection.matrix,
    u_world_size: projection.worldSize,
    u_dot_min_px: dotMinPx,
    u_dot_max_px: dotMaxPx,
    u_speed_ramp_gamma: options.speedRampGamma,
    u_max_age_sec: options.maxAgeSec,
    u_fade_in_age_ratio: options.fadeInAgeRatio,
    u_fade_out_age_ratio: options.fadeOutAgeRatio,
    u_stagnation_fade_start_mps: options.stagnationFadeStartMps,
    u_stagnation_fade_end_mps: options.stagnationFadeEndMps,
  })

  gl.enable(gl.BLEND)
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  )

  twgl.setUniforms(particleProgramInfo, {
    u_core_color_slow: options.coreSlow,
    u_core_color_fast: options.coreFast,
  })
  twgl.drawBufferInfo(gl, particleBufferInfo, gl.POINTS, particleCount)

  gl.disable(gl.BLEND)
  gl.useProgram(null)
}

function particleRenderPixelRatio(gl: WebGL2RenderingContext): number {
  const canvas = gl.canvas
  const cssWidth = 'clientWidth' in canvas ? canvas.clientWidth : 0
  const cssHeight = 'clientHeight' in canvas ? canvas.clientHeight : 0
  const ratios = [
    cssWidth > 0 ? gl.drawingBufferWidth / cssWidth : null,
    cssHeight > 0 ? gl.drawingBufferHeight / cssHeight : null,
  ].filter((value): value is number => value != null && Number.isFinite(value) && value > 0)

  const measuredRatio = ratios.length > 0
    ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length
    : null
  const fallbackRatio = typeof globalThis.devicePixelRatio === 'number'
    ? globalThis.devicePixelRatio
    : 1
  const ratio = measuredRatio ?? fallbackRatio

  if (!Number.isFinite(ratio) || ratio <= 0) return MIN_PARTICLE_PIXEL_RATIO
  return Math.min(MAX_PARTICLE_PIXEL_RATIO, Math.max(MIN_PARTICLE_PIXEL_RATIO, ratio))
}
