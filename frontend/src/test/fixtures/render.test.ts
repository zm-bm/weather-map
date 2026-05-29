import { describe, expect, it } from 'vitest'

import { createMockWebGl2 } from './render'

describe('render test fixtures', () => {
  it('exposes standardized encoded texture uniforms without stale renderer-specific names', () => {
    const gl = createMockWebGl2()
    const count = Number(gl.getProgramParameter({}, gl.ACTIVE_UNIFORMS))
    const activeUniformNames = Array.from({ length: count }, (_value, index) => (
      gl.getActiveUniform({}, index)?.name
    ))

    expect(activeUniformNames).toEqual(expect.arrayContaining([
      'u_encoded_tex',
      'u_encoded_tex_lower',
      'u_encoded_tex_upper',
      'u_pressure_tex_lower',
      'u_pressure_tex_upper',
    ]))
    expect(activeUniformNames).not.toEqual(expect.arrayContaining([
      'u_cloud_tex',
      'u_cloud_tex_upper',
      'u_precip_tex',
      'u_precip_tex_upper',
      'u_pressure_encoded_tex',
      'u_pressure_encoded_tex_lower',
      'u_pressure_encoded_tex_upper',
    ]))
  })
})
