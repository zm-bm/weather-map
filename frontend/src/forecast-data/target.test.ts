import { describe, expect, it } from 'vitest'

import { FORECAST_LAYERS_BY_ID, getAvailableParticleLayers } from '../forecast-catalog'
import { createManifestFixture, createActiveRunFixture } from '../test/fixtures'
import { createForecastDataTarget } from './target'

describe('createForecastDataTarget', () => {
  it('builds a stable request key from selected forecast state', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.wind_speed!
    const selectedParticleLayer = getAvailableParticleLayers(activeRun).wind!

    const target = createForecastDataTarget({
      activeRun,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: selectedParticleLayer.id,
      selectedParticleLayer,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        lowerHourToken: '3',
        upperHourToken: '6',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 3),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 6),
        mix: 1 / 6,
      },
      retryToken: 2,
    })

    expect(target.lowerHourToken).toBe('003')
    expect(target.upperHourToken).toBe('006')
    expect(target.requestKey).toBe('gfs:2026040900:rev:wind_speed:derived:wind-speed:wind10m_uv:particles:wind:wind10m_uv:003:006:30:2')
  })

  it('uses particles:none for missing particle layers', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!

    const target = createForecastDataTarget({
      activeRun,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: null,
      selectedParticleLayer: null,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3),
        lowerHourToken: '003',
        upperHourToken: '003',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 3),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 3),
        mix: 0,
      },
      retryToken: 0,
    })

    expect(target.requestKey).toContain(':particles:none:')
  })
})
