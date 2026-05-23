import { describe, expect, it } from 'vitest'

import {
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
} from '../forecast-catalog'
import { createManifestFixture, createActiveRunFixture } from '../test/fixtures'
import {
  createLayerDataSource,
  createWindVectorDataSource,
} from './catalog'
import {
  createForecastDataTarget,
} from './target'

describe('forecast data target adapters', () => {
  it('maps catalog field layers to data source descriptors', () => {
    const layer = FORECAST_LAYERS_BY_ID.wind_speed!

    expect(createLayerDataSource(layer)).toEqual({
      kind: 'field',
      layerId: 'wind_speed',
      paletteId: layer.paletteId,
      displayRange: [layer.displayRange.min, layer.displayRange.max],
      dataSource: {
        kind: 'derived',
        artifactId: 'wind10m_uv',
        recipe: 'wind-speed',
      },
      precipType: null,
    })
  })

  it('maps catalog cloud layers and precip overlays to data source descriptors', () => {
    const cloudLayer = FORECAST_LAYERS_BY_ID.cloud_layers!
    const precipLayer = FORECAST_LAYERS_BY_ID.precipitation_rate!

    expect(createLayerDataSource(cloudLayer)).toMatchObject({
      kind: 'cloudLayers',
      layerId: 'cloud_layers',
      artifactId: 'cloud_layers',
      precipType: null,
    })
    expect(createLayerDataSource(precipLayer).precipType).toEqual({
      id: 'precipitation_type',
      artifactId: 'precip_type_surface',
      optional: true,
    })
  })

  it('maps particle layers to wind-vector data source descriptors', () => {
    const manifest = createManifestFixture()
    const activeRun = createActiveRunFixture(manifest)
    const windLayer = getAvailableParticleLayers(activeRun).wind!

    expect(createWindVectorDataSource(windLayer)).toEqual({
      id: 'wind',
      artifactId: 'wind10m_uv',
    })
  })
})

describe('createForecastDataTarget', () => {
  it('builds a normalized target from selected forecast state', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.wind_speed!
    const windLayer = getAvailableParticleLayers(activeRun).wind!

    const target = createForecastDataTarget({
      activeRun,
      layerDataSource: createLayerDataSource(selectedLayer),
      windVectorDataSource: createWindVectorDataSource(windLayer),
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
    expect(target.windVectorDataSource).toEqual({
      id: 'wind',
      artifactId: 'wind10m_uv',
    })
    expect(target.layerDataSource.kind).toBe('field')
  })

  it('supports missing wind vector sources', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['003', '006'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)
    const selectedLayer = FORECAST_LAYERS_BY_ID.temperature!

    const target = createForecastDataTarget({
      activeRun,
      layerDataSource: createLayerDataSource(selectedLayer),
      windVectorDataSource: null,
      interpolationWindow: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3),
        lowerHourToken: '003',
        upperHourToken: '003',
        lowerValidTimeMs: Date.UTC(2026, 3, 9, 3),
        upperValidTimeMs: Date.UTC(2026, 3, 9, 3),
        mix: 0,
      },
    })

    expect(target.windVectorDataSource).toBeNull()
  })
})
