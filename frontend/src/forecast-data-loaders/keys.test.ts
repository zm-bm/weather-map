import { describe, expect, it } from 'vitest'

import {
  FORECAST_LAYERS_BY_ID,
} from '../forecast-catalog'
import { createLayerDataSource } from '../forecast-data-targets'
import { createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import {
  createFieldTimeSliceCacheKey,
  createFieldDataKey,
  createForecastDataRequestKey,
  createWindVectorDataKey,
} from './keys'

describe('forecast data keys', () => {
  it('builds scoped request and data keys from catalog sources', () => {
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026040900',
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = fieldSource('wind_speed')
    const windVectorDataSource = { id: 'wind', artifactId: 'wind10m_uv' }
    const fieldKey = createFieldDataKey(activeRun, selectedLayer)
    const windVectorKey = createWindVectorDataKey(activeRun, windVectorDataSource)

    expect(createForecastDataRequestKey({
      activeRun,
      dataKeys: [fieldKey, windVectorKey],
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
    const selectedLayer = fieldSource('temperature')

    expect(createFieldTimeSliceCacheKey({
      activeRun,
      source: selectedLayer,
      hourToken: '3',
    })).toBe('gfs:2026040900:rev:temperature:artifact:tmp_surface:003')
  })
})

function fieldSource(layerId: string) {
  const source = createLayerDataSource(FORECAST_LAYERS_BY_ID[layerId]!)
  if (source.kind !== 'field') throw new Error(`Expected field fixture ${layerId}`)
  return source
}
