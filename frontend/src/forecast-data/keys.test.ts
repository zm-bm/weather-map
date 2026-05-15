import { describe, expect, it } from 'vitest'

import {
  getAvailableLayers,
  getAvailableParticleLayers,
} from '../forecast-catalog'
import { createFrameManifestFixture } from '../test/fixtures'
import {
  createFieldTimeSliceCacheKey,
  createFieldChannelKey,
  createForecastDataRequestKey,
  createParticleChannelKey,
} from './keys'

describe('forecast data keys', () => {
  it('builds scoped request and channel keys from catalog sources', () => {
    const manifest = createFrameManifestFixture({
      cycle: '2026040900',
    })
    const selectedLayer = getAvailableLayers(manifest).wind_speed!
    const selectedParticleLayer = getAvailableParticleLayers(manifest).wind!

    expect(createForecastDataRequestKey({
      manifest,
      selectedLayer,
      selectedParticleLayer,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        lowerHourToken: '3',
        upperHourToken: '6',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 3),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 6),
        mix: 0.5,
      },
      retryToken: 2,
    })).toBe('2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv:particles:wind:wind10m_uv:003:006:30:2')
    expect(createFieldChannelKey(manifest, selectedLayer))
      .toBe('2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(createParticleChannelKey(manifest, selectedParticleLayer))
      .toBe('2026040900:rev:wind:wind10m_uv')
  })

  it('builds decoded field cache keys by layer source and normalized hour', () => {
    const manifest = createFrameManifestFixture({
      cycle: '2026040900',
    })
    const selectedLayer = getAvailableLayers(manifest).temperature!

    expect(createFieldTimeSliceCacheKey({
      manifest,
      layer: selectedLayer,
      hourToken: '3',
    })).toBe('2026040900:rev:temperature:artifact:tmp_surface:003')
  })
})
