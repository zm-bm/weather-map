import { describe, expect, it } from 'vitest'

import {
  FORECAST_LAYERS_BY_ID,
} from '../forecast-catalog'
import { createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import {
  createFieldTimeSliceCacheKey,
  createFieldChannelKey,
  createForecastProductRequestKey,
  createWindVectorChannelKey,
} from './keys'

describe('forecast products keys', () => {
  it('builds scoped request and channel keys from catalog sources', () => {
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026040900',
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.wind_speed!
    const windVectorSource = { id: 'wind', artifactId: 'wind10m_uv' }
    const fieldKey = createFieldChannelKey(activeRun, selectedLayer)
    const windVectorKey = createWindVectorChannelKey(activeRun, windVectorSource)

    expect(createForecastProductRequestKey({
      activeRun,
      productKeys: [fieldKey, windVectorKey],
      lowerHourToken: '3',
      upperHourToken: '6',
      minuteOffset: 30,
      retryToken: 2,
    })).toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv|gfs:2026040900:rev:wind-vectors:wind:wind10m_uv:003:006:30:2')
    expect(fieldKey).toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv')
    expect(windVectorKey).toBe('gfs:2026040900:rev:wind-vectors:wind:wind10m_uv')
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
