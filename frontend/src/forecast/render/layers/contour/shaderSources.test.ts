import { describe, expect, it } from 'vitest'

import {
  PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE,
  PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE,
} from './shaders'

describe('pressure contour shader sources', () => {
  it('prefilters raw encoded pressure into an hPa field with coverage', () => {
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('out vec2 outPressureField')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('u_scale')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('u_offset')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('/ PASCALS_PER_HECTOPASCAL')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('pressureKernelWeight')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('pressureMissingValue')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('for (int y = -1; y <= 1; y++)')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('totalWeight / SMOOTHING_FULL_WEIGHT')
  })

  it('uses smoothed pressure field marching squares in the main contour shader', () => {
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('samplePressureFieldCell')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('blendPressureFieldCells')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('pressureMarchingSquareSegments')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('pressureEdgeIntersection')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('firstContourLevelForCell')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('MAX_CONTOUR_LEVELS_PER_CELL')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('CONTOUR_EDGE_EPSILON_HPA')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('addUniqueContourIntersection')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('pressureSaddleUsesBottomRightPairing')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('pressureSegmentDistancePx')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('pressureContourLineColor')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('MIN_CONTOUR_COVERAGE')
  })

  it('clips contour fragments outside the visible globe hemisphere', () => {
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('uniform highp vec4 u_projection_clipping_plane')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('uniform highp float u_projection_transition')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('bool globeFragmentOutsideVisibleHemisphere(vec2 mercator)')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('if (globeFragmentOutsideVisibleHemisphere(v_mercator))')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('discard;')
  })
})
