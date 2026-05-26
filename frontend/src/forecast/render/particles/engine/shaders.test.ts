import { describe, expect, it } from 'vitest'

import {
  VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
  VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
  VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
} from './shaders'

describe('particle shader source', () => {
  it('uses particle age to fade dots in and out', () => {
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_max_age_sec')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_fade_in_age_ratio')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_fade_out_age_ratio')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('out float v_life_alpha')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('float particle_life_alpha(float age)')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('v_life_alpha = particle_life_alpha(a_state.z)')

    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('in float v_life_alpha')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('color.a * shape * v_life_alpha')
  })

  it('uses speed-scaled dots without dash or shadow uniforms', () => {
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_dot_min_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_dot_max_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('out float v_dot_diameter')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain(
      'v_dot_diameter = mix(dot_min, dot_max, v_speed_t)'
    )
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('gl_PointSize = max(dot_max + 2.0, 1.0)')

    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('uniform vec4 u_core_color_slow')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('uniform vec4 u_core_color_fast')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('uniform float u_dot_min_px')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('uniform float u_dot_max_px')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('in float v_dot_diameter')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain(
      'mix(u_core_color_slow, u_core_color_fast, v_speed_t)'
    )
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('length(px)')

    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('u_color_slow')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('u_color_fast')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_dash_min_len_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_dash_max_len_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_dash_len_per_mps')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('v_dash_len')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('v_dir')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('u_dash_width_px')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('u_core_width_px')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('v_dash_len')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('v_dir')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('shadow')
  })

  it('outputs premultiplied alpha for trail accumulation', () => {
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain(
      'float alpha = color.a * shape * v_life_alpha * v_stagnation_alpha'
    )
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain(
      'out_color = vec4(color.rgb * alpha, alpha)'
    )
  })

  it('fades calm particles before they contribute to trails', () => {
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_stagnation_fade_start_mps')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_stagnation_fade_end_mps')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('out float v_stagnation_alpha')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('float particle_stagnation_alpha(float speed_mps)')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain(
      'v_stagnation_alpha = particle_stagnation_alpha(speed_mps)'
    )

    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain('in float v_stagnation_alpha')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).toContain(
      'color.a * shape * v_life_alpha * v_stagnation_alpha'
    )
  })

  it('respawns particles trapped in stagnant flow', () => {
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform float u_stagnation_respawn_start_mps')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform float u_stagnation_respawn_end_mps')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform float u_stagnation_respawn_per_sec')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('float stagnation_t = 1.0 - smoothstep')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('float stagnation_respawn_prob = clamp')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('stagnation_respawn_roll < stagnation_respawn_prob')
  })
})
