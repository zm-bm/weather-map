import { describe, expect, it } from 'vitest'

import { getAvailableLayers, getAvailableParticleLayers } from '../forecast-catalog'
import { createManifestFixture } from '../test/fixtures'
import { createForecastFrameTarget } from './target'

describe('createForecastFrameTarget', () => {
  it('builds a stable request key from selected forecast state', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
    })
    const selectedLayer = getAvailableLayers(manifest).wind_speed_surface!
    const selectedParticleLayer = getAvailableParticleLayers(manifest).wind_particles!

    const target = createForecastFrameTarget({
      manifest,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: selectedParticleLayer.id,
      selectedParticleLayer,
      frameWindow: {
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
    expect(target.requestKey).toBe('2026040900:rev:wind_speed_surface:derived:wind-speed:wind10m_uv:particles:wind10m_uv:003:006:30:2')
  })

  it('uses particles:none for missing particle layers', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
      vectorProducts: [],
    })
    const selectedLayer = getAvailableLayers(manifest).tmp_surface!

    const target = createForecastFrameTarget({
      manifest,
      selectedLayerId: selectedLayer.id,
      selectedLayer,
      selectedParticleLayerId: null,
      selectedParticleLayer: null,
      frameWindow: {
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
