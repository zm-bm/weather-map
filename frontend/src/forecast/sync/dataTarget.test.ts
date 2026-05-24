import { describe, expect, it } from 'vitest'

import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
} from '@/forecast/catalog'
import { createActiveRunFixture, createManifestFixture } from '@/test/fixtures'
import { resolveDataTarget } from './dataTarget'

describe('resolveDataTarget', () => {
  it('returns null for unloaded or unrenderable selection state', () => {
    const manifest = createManifestFixture()
    const activeRun = createActiveRunFixture(manifest)

    expect(resolveDataTarget({
      activeRun: null,
      layers: FORECAST_LAYERS_BY_ID,
      selectedLayerId: 'temperature',
      selectedLayerIsRenderable: true,
      particleLayers: getAvailableParticleLayers(activeRun),
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
    })).toBeNull()

    expect(resolveDataTarget({
      activeRun,
      layers: FORECAST_LAYERS_BY_ID,
      selectedLayerId: 'temperature',
      selectedLayerIsRenderable: false,
      particleLayers: getAvailableParticleLayers(activeRun),
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
    })).toBeNull()
  })

  it('resolves field layers, derived field sources, and wind vectors', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
    })
    const activeRun = createActiveRunFixture(manifest)

    const target = resolveDataTarget({
      activeRun,
      layers: FORECAST_LAYERS_BY_ID,
      selectedLayerId: 'wind_speed',
      selectedLayerIsRenderable: true,
      particleLayers: getAvailableParticleLayers(activeRun),
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
    })

    expect(target).toEqual(expect.objectContaining({
      lowerHourToken: '003',
      upperHourToken: '006',
      mix: 1 / 6,
      minuteOffset: 30,
      windVectorSource: {
        id: 'wind',
        artifactId: 'wind10m_uv',
      },
    }))
    expect(target?.layerSource).toEqual(expect.objectContaining({
      kind: 'field',
      layerId: 'wind_speed',
      fieldSource: {
        kind: 'derived',
        artifactId: 'wind10m_uv',
        recipe: 'wind-speed',
      },
      precipType: null,
    }))
  })

  it('resolves cloud layer sources and precipitation overlays', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000'],
    })
    const activeRun = createActiveRunFixture(manifest)

    const cloudTarget = resolveDataTarget({
      activeRun,
      layers: FORECAST_LAYERS_BY_ID,
      selectedLayerId: 'cloud_layers',
      selectedLayerIsRenderable: true,
      particleLayers: null,
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
    })
    const precipTarget = resolveDataTarget({
      activeRun,
      layers: FORECAST_LAYERS_BY_ID,
      selectedLayerId: 'precipitation_rate',
      selectedLayerIsRenderable: true,
      particleLayers: null,
      selectedParticleLayerId: null,
      targetTimeMs: Date.UTC(2026, 3, 9),
    })

    expect(cloudTarget?.layerSource).toEqual(expect.objectContaining({
      kind: 'cloudLayers',
      layerId: 'cloud_layers',
      artifactId: 'cloud_layers',
      precipType: null,
    }))
    expect(cloudTarget?.windVectorSource).toBeNull()
    expect(precipTarget?.layerSource.precipType).toEqual({
      id: 'precipitation_type',
      artifactId: 'precip_type_surface',
      optional: true,
    })
  })

  it('returns null when the selected layer is absent from the catalog map', () => {
    const manifest = createManifestFixture()
    const activeRun = createActiveRunFixture(manifest)

    expect(resolveDataTarget({
      activeRun,
      layers: {},
      selectedLayerId: 'temperature',
      selectedLayerIsRenderable: true,
      particleLayers: getAvailableParticleLayers(activeRun),
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9),
    })).toBeNull()
  })
})
