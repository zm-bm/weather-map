import { describe, expect, it } from 'vitest'

import {
  VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE,
  VECTOR_PARTICLE_VERTEX_SHADER_SOURCE,
  VECTOR_UPDATE_VERTEX_SHADER_SOURCE,
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

  it('uses speed-scaled dots without dash or shadow uniforms', () => {
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

    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('u_color_slow')
    expect(VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE).not.toContain('u_color_fast')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_dash_min_len_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_dash_max_len_px')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_dash_len_per_mps')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('v_dash_len')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('v_dir')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('u_vector_tex_lower')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('sample_vector_bilinear')
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

  it('stores speed in transform feedback particle state', () => {
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('layout(location = 0) in vec4 a_state')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('out vec4 v_state')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('return vec4(lon, lat, 0.0, 0.0)')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('v_state = vec4(next_lon, next_lat, age, speed_mps)')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('layout(location = 0) in vec4 a_state')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).toContain('a_state.w')
  })

  it('decodes signed integer wind vectors with manifest scale and offset uniforms', () => {
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('precision highp isampler2D')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform isampler2D u_vector_tex_lower')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform isampler2D u_vector_tex_upper')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform float u_vector_scale')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform float u_vector_offset')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform int u_x_wrap')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform int u_y_mode')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('ivec2 stored = texelFetch')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain(
      'return (vec2(stored) * u_vector_scale) + u_vector_offset'
    )
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('uniform float u_vector_scale')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('uniform float u_vector_offset')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).not.toContain(
      'return vec2(decode_i8(texel.r), decode_i8(texel.g)) * 0.5'
    )
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).not.toContain('decode_i8')
    expect(VECTOR_PARTICLE_VERTEX_SHADER_SOURCE).not.toContain('decode_i8')
  })

  it('reuses shared encodedGrid lookup math while keeping packed wind texture sampling', () => {
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('struct EncodedGridLocation')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('encodedGridLocationForLonLat')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('location.valid <= 0.0')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('vector_lower.z <= 0.0 || vector_upper.z <= 0.0')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('ivec2(location.x0, location.y0)')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).toContain('uniform isampler2D u_vector_tex_lower')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).not.toContain('isampler2DArray')
    expect(VECTOR_UPDATE_VERTEX_SHADER_SOURCE).not.toContain('float lon_norm = lon - u_lon0')
  })
})
