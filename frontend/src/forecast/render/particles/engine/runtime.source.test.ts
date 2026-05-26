import { describe, expect, it } from 'vitest'

import RUNTIME_SOURCE from './runtime.ts?raw'

describe('particle runtime source', () => {
  it('uses premultiplied alpha blending for particles and trail composite', () => {
    expect(RUNTIME_SOURCE).toContain('gl.blendFuncSeparate(')
    expect(RUNTIME_SOURCE).not.toContain('gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)')

    const premultipliedBlendCount = RUNTIME_SOURCE.match(/gl\.blendFuncSeparate\(/g)?.length ?? 0
    const premultipliedBlendArguments = RUNTIME_SOURCE.match(
      /gl\.blendFuncSeparate\(\s*gl\.ONE,\s*gl\.ONE_MINUS_SRC_ALPHA,\s*gl\.ONE,\s*gl\.ONE_MINUS_SRC_ALPHA,\s*\)/g
    )?.length ?? 0
    expect(premultipliedBlendCount).toBe(2)
    expect(premultipliedBlendArguments).toBe(2)
  })

  it('passes stagnation drain settings to update and draw shaders', () => {
    expect(RUNTIME_SOURCE).toContain('u_stagnation_respawn_start_mps: options.stagnationRespawnStartMps')
    expect(RUNTIME_SOURCE).toContain('u_stagnation_respawn_end_mps: options.stagnationRespawnEndMps')
    expect(RUNTIME_SOURCE).toContain('u_stagnation_respawn_per_sec: options.stagnationRespawnPerSec')
    expect(RUNTIME_SOURCE).toContain('u_stagnation_fade_start_mps: options.stagnationFadeStartMps')
    expect(RUNTIME_SOURCE).toContain('u_stagnation_fade_end_mps: options.stagnationFadeEndMps')
  })

  it('passes dot settings to draw shaders without dash settings', () => {
    expect(RUNTIME_SOURCE).toContain('u_dot_min_px: options.dotMinPx')
    expect(RUNTIME_SOURCE).toContain('u_dot_max_px: options.dotMaxPx')

    expect(RUNTIME_SOURCE).not.toContain('u_point_size: options.pointSizePx')
    expect(RUNTIME_SOURCE).not.toContain('u_dash_min_len_px: options.dashMinPx')
    expect(RUNTIME_SOURCE).not.toContain('u_dash_max_len_px: options.dashMaxPx')
    expect(RUNTIME_SOURCE).not.toContain('u_dash_len_per_mps: options.dashPerMps')
    expect(RUNTIME_SOURCE).not.toContain('u_core_width_px: options.coreWidthPx')
    expect(RUNTIME_SOURCE).not.toContain('u_dir_step_sec: options.dirSampleStepSec')
  })
})
