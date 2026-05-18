import { describe, expect, it } from 'vitest'

import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
} from '../forecast-catalog'
import { createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import {
  createFieldTimeSliceCacheKey,
  createFieldChannelKey,
  createForecastDataRequestKey,
  createParticleChannelKey,
} from './keys'

describe('forecast data keys', () => {
  it('builds scoped request and channel keys from catalog sources', () => {
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026040900',
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.wind_speed!
    const selectedParticleLayer = getAvailableParticleLayers(activeRun).wind!

    expect(createForecastDataRequestKey({
      activeRun,
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
    })).toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv:particles:wind:wind10m_uv:003:006:30:2')
    expect(createFieldChannelKey(activeRun, selectedLayer))
      .toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(createParticleChannelKey(activeRun, selectedParticleLayer))
      .toBe('gfs:2026040900:rev:wind:wind10m_uv')
  })

  it('builds decoded field cache keys by layer source and normalized hour', () => {
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026040900',
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!

    expect(createFieldTimeSliceCacheKey({
      activeRun,
      layer: selectedLayer,
      hourToken: '3',
    })).toBe('gfs:2026040900:rev:temperature:artifact:tmp_surface:003')
  })
})
