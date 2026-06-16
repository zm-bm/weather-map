import * as twgl from 'twgl.js'

import type { ParticleRenderSettings } from '@/forecast/settings/settings'
import type { ParticlePassState } from './index'

export function runParticlePass(state: ParticlePassState, options: ParticleRenderSettings): void {
  const { gl } = state
  if (!gl) return

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  drawParticleGeometryPass(state, options)
}

export function drawParticleGeometryPass(
  state: ParticlePassState,
  options: ParticleRenderSettings
): void {
  const {
    gl,
    viewport,
    particleProgramInfo,
    stateBufferInfos,
    activeSourceIndex,
    particleCount,
  } = state
  if (
    !gl ||
    !viewport ||
    !particleProgramInfo ||
    !stateBufferInfos[activeSourceIndex]
  ) {
    return
  }

  const particleBufferInfo = stateBufferInfos[activeSourceIndex]
  if (!particleBufferInfo) return

  gl.useProgram(particleProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, particleProgramInfo, particleBufferInfo)
  twgl.setUniforms(particleProgramInfo, {
    u_bounds_west: viewport.west,
    u_bounds_east: viewport.east,
    u_mercator_bounds: [
      viewport.mercatorWestX,
      viewport.mercatorEastX,
      viewport.mercatorNorthY,
      viewport.mercatorSouthY,
    ],
    u_dot_min_px: options.dotMinPx,
    u_dot_max_px: options.dotMaxPx,
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
