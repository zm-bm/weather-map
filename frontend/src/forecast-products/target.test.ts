import { describe, expect, it } from 'vitest'

import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { createManifestFixture, createActiveRunFixture } from '../test/fixtures'
import { createForecastProductTarget } from './target'

describe('createForecastProductTarget', () => {
  it('builds a normalized target from selected forecast state', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.wind_speed!
    const windLayer = getAvailableParticleLayers(activeRun).wind!

    const target = createForecastProductTarget({
      activeRun,
      selectedLayer,
      windVectorSource: {
        id: String(windLayer.id),
        artifactId: particleLayerSourceArtifactId(windLayer),
      },
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        lowerHourToken: '3',
        upperHourToken: '6',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 3),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 6),
        mix: 1 / 6,
      },
    })

    expect(target.lowerHourToken).toBe('003')
    expect(target.upperHourToken).toBe('006')
    expect(target.minuteOffset).toBe(30)
    expect(target.windVectorSource).toEqual({
      id: 'wind',
      artifactId: 'wind10m_uv',
    })
  })

  it('supports missing wind vector sources', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!

    const target = createForecastProductTarget({
      activeRun,
      selectedLayer,
      windVectorSource: null,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3),
        lowerHourToken: '003',
        upperHourToken: '003',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 3),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 3),
        mix: 0,
      },
    })

    expect(target.windVectorSource).toBeNull()
  })
})
