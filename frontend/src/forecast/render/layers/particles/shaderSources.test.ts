import { describe, expect, it } from 'vitest'

import {
  VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
  VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
} from './shaderSources'

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

  it('uses speed-scaled dots', () => {
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_dot_min_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('uniform float u_dot_max_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('out float v_dot_diameter')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('float speed_mps = max(a_state.w, 0.0)')
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

  it('reads speed from the CPU-updated particle state', () => {
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('layout(location = 0) in vec4 a_state')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('a_state.w')
  })

  it('projects particles with MapLibre projection shader helpers', () => {
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('vec2 world_pos = vec2(mercator_x(lon), mercator_y(lat))')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain(
      'gl_Position = projectTile(world_pos)'
    )
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('uniform mat4 u_matrix')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('uniform float u_world_size')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_mercator_bounds')
  })
})
