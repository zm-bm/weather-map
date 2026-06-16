import { describe, expect, it } from 'vitest'

import {
  ENCODED_DERIVED_GLSL,
  ENCODED_GRID_GLSL,
  ENCODED_GRID_LOCATION_GLSL,
  ENCODED_SAMPLE_GLSL,
  ENCODED_TEXTURE_ARRAY_GLSL,
} from './shaderSources'

describe('encoded grid shader source', () => {
  it('exposes the shared lookup, decode, sampling, and blending contract', () => {
    expect(ENCODED_GRID_GLSL).toContain('struct EncodedSample')
    expect(ENCODED_GRID_GLSL).toContain('struct EncodedGridLocation')
    expect(ENCODED_GRID_GLSL).toContain('const int ENCODED_GRID_X_WRAP_REPEAT')
    expect(ENCODED_GRID_GLSL).toContain('const int ENCODED_GRID_Y_MODE_CLAMP')
    expect(ENCODED_GRID_GLSL).toContain('float mercatorYToLatitude')
    expect(ENCODED_GRID_GLSL).toContain('EncodedGridLocation encodedGridLocationForMercator')
    expect(ENCODED_GRID_GLSL).toContain('location.valid <= 0.0')
    expect(ENCODED_GRID_GLSL).toContain('bool encodedIsMissing')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleLinearBilinearLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleLinearNearestClampedTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleLinearNearestTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleLinearTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleLinearClampedTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleTempCBilinearLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleTempCNearestTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleTempCTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleWindSpeedBilinearLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleWindSpeedNearestTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample sampleWindSpeedTemporalLayer')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample blendEncodedSamples')
    expect(ENCODED_GRID_GLSL).toContain('EncodedSample clampEncodedSample')
  })

  it('exposes smaller GLSL contracts for renderers that only need part of the encoded grid path', () => {
    expect(ENCODED_GRID_LOCATION_GLSL).toContain('struct EncodedGridLocation')
    expect(ENCODED_GRID_LOCATION_GLSL).toContain('EncodedGridLocation encodedGridLocationForLonLat')
    expect(ENCODED_SAMPLE_GLSL).toContain('struct EncodedSample')
    expect(ENCODED_SAMPLE_GLSL).toContain('EncodedSample blendEncodedSamples')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleLinearBilinearLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleLinearNearestClampedTemporalLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleLinearNearestTemporalLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleLinearTemporalLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleLinearClampedTemporalLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleTempCBilinearLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleTempCNearestTemporalLayer')
    expect(ENCODED_TEXTURE_ARRAY_GLSL).toContain('EncodedSample sampleTempCTemporalLayer')
    expect(ENCODED_DERIVED_GLSL).toContain('EncodedSample sampleWindSpeedBilinearLayer')
    expect(ENCODED_DERIVED_GLSL).toContain('EncodedSample sampleWindSpeedNearestTemporalLayer')
    expect(ENCODED_DERIVED_GLSL).toContain('EncodedSample sampleWindSpeedTemporalLayer')
  })
})
