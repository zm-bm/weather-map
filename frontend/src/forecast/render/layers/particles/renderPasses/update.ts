import * as twgl from 'twgl.js'

import { clamp } from '@/core/math'
import type { ParticleRenderSettings } from '@/forecast/settings/settings'
import { expandViewportBounds } from '../geo'
import { getStateBufferFromInfo } from '../stateBuffers'
import { packedVectorFramePairUniforms } from '../vectorTexture'
import type { ParticlePassState } from './index'

const EARTH_DEG_PER_METER = 360 / (2 * Math.PI * 6378137)

export function runUpdatePass(
  state: ParticlePassState,
  dtSec: number,
  nowMs: number,
  options: ParticleRenderSettings,
): void {
  const {
    gl,
    updateProgramInfo,
    vectorFramePair,
    transformFeedback,
    stateBufferInfos,
    activeSourceIndex,
    particleCount,
    viewport,
    map,
  } = state
  if (
    !gl ||
    !updateProgramInfo ||
    !vectorFramePair ||
    !transformFeedback ||
    !stateBufferInfos[0] ||
    !stateBufferInfos[1] ||
    !viewport
  ) {
    return
  }

  const srcBufferInfo = stateBufferInfos[activeSourceIndex]
  const dstBufferInfo = stateBufferInfos[activeSourceIndex === 0 ? 1 : 0]
  if (!srcBufferInfo || !dstBufferInfo) return

  const dstBuffer = getStateBufferFromInfo(dstBufferInfo)
  if (!dstBuffer) return

  const zoom = map?.getZoom() ?? options.flowRefZoom
  const forcedRespawnFrac = clamp(state.pendingForcedRespawnFrac, 0, 1)
  const simulationBounds = expandViewportBounds(viewport, options.simulationViewportPaddingRatio)
  gl.useProgram(updateProgramInfo.program)
  twgl.setBuffersAndAttributes(gl, updateProgramInfo, srcBufferInfo)
  twgl.setUniforms(updateProgramInfo, {
    u_dt_sec: dtSec,
    u_seed: nowMs * 0.001,
    ...packedVectorFramePairUniforms(vectorFramePair),
    u_speed_multiplier: options.flowSpeedScale,
    u_zoom_scale: Math.pow(2, options.flowRefZoom - zoom),
    u_deg_per_meter: EARTH_DEG_PER_METER,
    u_max_age_sec: options.maxAgeSec,
    u_base_respawn_per_sec: options.respawnBasePerSec,
    u_speed_respawn_per_mps: options.respawnSpeedPerMps,
    u_stagnation_respawn_start_mps: options.stagnationRespawnStartMps,
    u_stagnation_respawn_end_mps: options.stagnationRespawnEndMps,
    u_stagnation_respawn_per_sec: options.stagnationRespawnPerSec,
    u_forced_respawn_frac: forcedRespawnFrac,
    u_motion_jitter_ratio: options.jitterRatio,
    u_motion_speed_floor_mps: options.motionSpeedFloorMps,
    u_bounds_west: simulationBounds?.west ?? viewport.west,
    u_bounds_east: simulationBounds?.east ?? viewport.east,
    u_bounds_south: simulationBounds?.south ?? viewport.south,
    u_bounds_north: simulationBounds?.north ?? viewport.north,
  })

  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback)
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dstBuffer)

  gl.enable(gl.RASTERIZER_DISCARD)
  gl.beginTransformFeedback(gl.POINTS)
  twgl.drawBufferInfo(gl, srcBufferInfo, gl.POINTS, particleCount)
  gl.endTransformFeedback()
  gl.disable(gl.RASTERIZER_DISCARD)

  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
  gl.useProgram(null)
  state.pendingForcedRespawnFrac = 0
  state.activeSourceIndex = activeSourceIndex === 0 ? 1 : 0
}
