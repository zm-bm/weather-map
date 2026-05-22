import { describe, expect, it } from 'vitest'

import { CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE } from './shaders'

describe('cloud layers shader source', () => {
  it('keeps the low middle high component path and derived coverage formula', () => {
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('const float CLOUD_NODATA_BYTE = 255.0')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('sampleCloudComponent(u_cloud_tex, 0')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('sampleCloudComponent(u_cloud_tex, 1')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('sampleCloudComponent(u_cloud_tex, 2')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain(
      'return 1.0 - ((1.0 - lowCover) * (1.0 - middleCover) * (1.0 - highCover));'
    )
  })

  it('uses Windy-style grayscale density and relief instead of colored deck tints', () => {
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('uniform float u_zoom')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('cloudTextureNoise')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('cloudOpacityMax(zoom)')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('windyGrayscaleCloud')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('cloudReliefShade')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('sampleCloudDecks(gridX + sampleStep')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('float strongestDeck = max(max(lowCover, middleCover), highCover);')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).not.toContain('naturalCloudColor')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).not.toContain('HIGH_CLOUD_TINT')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).not.toContain('HIGH_DECK_THIN')
  })
})
