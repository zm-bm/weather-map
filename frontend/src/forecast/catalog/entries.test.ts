import { describe, expect, it } from 'vitest'

import {
  type ActiveForecastRun,
} from '@/forecast/manifest'
import {
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '@/test/fixtures'
import {
  FORECAST_RASTER_LAYER_GROUPS,
  FORECAST_RASTER_LAYERS,
  FORECAST_RASTER_LAYERS_BY_ID,
  CONTOUR_LAYERS,
  PARTICLE_LAYERS,
  getDefaultRasterLayerId,
  getForecastRasterLayer,
  OVERLAY_LAYERS,
  requireForecastRasterLayer,
  type ForecastRasterLayer,
} from './entries'
import {
  getAvailableParticleLayer,
  getDefaultAvailableContourLayer,
  getDefaultAvailableParticleLayerId,
  isForecastRasterLayerAvailable,
  resolveRenderableRasterLayer,
} from './availability'

function isLayerAvailableForActiveRun(
  activeRun: ActiveForecastRun,
  layer: ForecastRasterLayer
): boolean {
  return isForecastRasterLayerAvailable(activeRun, layer)
}

function requireRasterLayer(layer: ForecastRasterLayer | undefined): ForecastRasterLayer {
  if (layer == null) {
    throw new Error('Expected raster layer')
  }
  return layer
}

describe('layer catalog', () => {
  it('defines display behavior for every layer', () => {
    expect(FORECAST_RASTER_LAYERS.every((layer) => layer.displayProfile && layer.display.units && layer.display.kind)).toBe(true)
    expect(FORECAST_RASTER_LAYERS.every((layer) => ['gradient', 'cloud-layers'].includes(layer.display.kind))).toBe(true)
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.temperature).displayProfile).toBe('temperature')
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.apparent_temperature).displayProfile).toBe('apparent-temperature')
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.wind_speed).displayProfile).toBe('wind-speed')
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.wind_gust).displayProfile).toBe('wind-gust')
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.relative_humidity).displayProfile).toBe('relative-humidity')
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.cloud_cover).displayProfile).toBe('cloud-cover')
  })

  it('keeps layer ids and group membership internally consistent', () => {
    const layerIds = FORECAST_RASTER_LAYERS.map((layer) => String(layer.id))
    const groupIds = FORECAST_RASTER_LAYER_GROUPS.map((group) => String(group.id))

    expect(new Set(layerIds).size).toBe(layerIds.length)
    expect(new Set(groupIds).size).toBe(groupIds.length)

    const layersById = new Map(FORECAST_RASTER_LAYERS.map((layer) => [String(layer.id), layer]))

    for (const group of FORECAST_RASTER_LAYER_GROUPS) {
      expect(group.rasterLayerIds[0]).toBeDefined()
      for (const layerId of group.rasterLayerIds) {
        expect(layersById.has(String(layerId))).toBe(true)
      }
    }

    for (const layer of FORECAST_RASTER_LAYERS) {
      const matchingGroups = FORECAST_RASTER_LAYER_GROUPS.filter((group) => group.id === layer.groupId)
      expect(matchingGroups.map((group) => String(group.id))).toEqual([String(layer.groupId)])
      expect(matchingGroups[0]!.rasterLayerIds).toContain(layer.id)
    }
  })

  it('keeps independent render layer ids distinct from source artifact ids', () => {
    for (const layer of [...CONTOUR_LAYERS, ...PARTICLE_LAYERS]) {
      expect(String(layer.id)).not.toBe(String(layer.source.artifactId))
    }
  })

  it('resolves forecast layer defaults and lookups', () => {
    expect(getDefaultRasterLayerId()).toBe('temperature')
    const cloudGroup = FORECAST_RASTER_LAYER_GROUPS.find((group) => group.rasterLayerIds.includes(FORECAST_RASTER_LAYERS_BY_ID.cloud_layers!.id))
    const windGroup = FORECAST_RASTER_LAYER_GROUPS.find((group) => group.id === 'wind_pressure')
    expect(cloudGroup?.id).toBe('clouds_visibility')
    expect(windGroup?.rasterLayerIds[0]).toBe('wind_gust')
    expect(getForecastRasterLayer(null)).toBeNull()
    expect(getForecastRasterLayer('temperature')).toBe(FORECAST_RASTER_LAYERS_BY_ID.temperature)
    expect(getForecastRasterLayer('missing-layer')).toBeNull()
    expect(requireForecastRasterLayer('temperature')).toBe(FORECAST_RASTER_LAYERS_BY_ID.temperature)
    expect(() => requireForecastRasterLayer('missing-layer')).toThrow('Missing layer catalog entry for missing-layer')
  })

  it('resolves available particle layers', () => {
    const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
      vectorArtifactIds: ['wind10m_uv'],
    }))

    const windLayer = getAvailableParticleLayer(activeRun, 'wind')

    expect(getDefaultAvailableParticleLayerId(activeRun)).toBe('wind')
    expect(getAvailableParticleLayer(activeRun, 'wind')).toBe(windLayer)
    expect(getAvailableParticleLayer(activeRun, 'missing')).toBeNull()
    expect(getAvailableParticleLayer(activeRun, null)).toBeNull()
    expect(windLayer).toMatchObject({
      id: 'wind',
      source: {
        artifactId: 'wind10m_uv',
        bands: [{ id: 'u' }, { id: 'v' }],
      },
    })
    expect(getDefaultAvailableParticleLayerId(null)).toBeNull()
  })

  it('resolves available contour layers from pressure artifact metadata', () => {
    const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
      scalarArtifactIds: ['prmsl_msl'],
    }))

    const pressureContours = getDefaultAvailableContourLayer(activeRun)

    expect(getDefaultAvailableContourLayer(activeRun)).toBe(pressureContours)
    expect(pressureContours).toMatchObject({
      id: 'pressure_contours',
      source: {
        artifactId: 'prmsl_msl',
        bands: [{ id: 'value' }],
      },
    })
    expect(getDefaultAvailableContourLayer(null)).toBeNull()
  })

  it('defines Cloud Layers as the default Clouds layer backed by low middle high cloud vectors', () => {
    const cloudGroup = FORECAST_RASTER_LAYER_GROUPS.find((group) => group.id === 'clouds_visibility')
    const cloudLayers = requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.cloud_layers)

    expect(cloudGroup?.label).toBe('Clouds')
    expect(cloudGroup?.rasterLayerIds[0]).toBe('cloud_layers')
    expect(cloudGroup?.rasterLayerIds).toEqual([
      cloudLayers.id,
      FORECAST_RASTER_LAYERS_BY_ID.cloud_cover!.id,
    ])
    expect(cloudLayers).toMatchObject({
      display: {
        label: 'Cloud Layers',
      },
      source: {
        artifactId: 'cloud_layers',
        bands: [
          { id: 'low' },
          { id: 'middle' },
          { id: 'high' },
        ],
      },
    })
    expect(requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.cloud_cover).display.label).toBe('Total/Sky Cover')
  })

  it('accepts Cloud Layers only when low middle high components are available', () => {
    const cloudLayers = requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.cloud_layers)
    const availableManifest = createSingleTimeManifestFixture({
      artifacts: {
        cloud_layers: createVectorArtifactFixture({
          id: 'cloud_layers',
          components: ['low', 'middle', 'high'],
        }),
      },
    })
    const badManifest = createSingleTimeManifestFixture({
      artifacts: {
        cloud_layers: createVectorArtifactFixture({
          id: 'cloud_layers',
          components: ['low', 'high', 'middle'],
        }),
      },
    })

    expect(isLayerAvailableForActiveRun(createActiveRunFixture(availableManifest), cloudLayers)).toBe(true)
    expect(isLayerAvailableForActiveRun(createActiveRunFixture(badManifest), cloudLayers)).toBe(false)
    expect(resolveRenderableRasterLayer(createActiveRunFixture(availableManifest), 'cloud_layers')).toMatchObject({
      layer: { id: 'cloud_layers' },
      artifact: { id: 'cloud_layers' },
    })
    expect(resolveRenderableRasterLayer(createActiveRunFixture(badManifest), 'cloud_layers')).toBeNull()
  })

  it('accepts frontend-derived wind speed when vector wind is available', () => {
    const manifest = createSingleTimeManifestFixture({
      scalarArtifactIds: ['gust_surface', 'prmsl_msl'],
      vectorArtifactIds: ['wind10m_uv'],
    })

    const windSpeed = requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.wind_speed)
    const activeRun = createActiveRunFixture(manifest)

    expect(windSpeed.source).toMatchObject({
      artifactId: 'wind10m_uv',
      bands: [
        { id: 'u' },
        { id: 'v' },
      ],
    })
    expect(isLayerAvailableForActiveRun(activeRun, windSpeed)).toBe(true)
    expect(resolveRenderableRasterLayer(activeRun, 'wind_speed')).toMatchObject({
      layer: { id: 'wind_speed' },
      artifact: { id: 'wind10m_uv' },
    })
  })

  it('hides frontend-derived wind speed when vector wind components are unavailable', () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture({
          components: ['speed'],
        }),
        gust_surface: createScalarArtifactFixture({
          id: 'gust_surface',
        }),
      },
      scalarArtifactIds: ['gust_surface'],
      vectorArtifactIds: ['wind10m_uv'],
    })
    const activeRun = createActiveRunFixture(manifest)

    expect(isLayerAvailableForActiveRun(activeRun, requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.wind_speed))).toBe(false)
    expect(isLayerAvailableForActiveRun(activeRun, requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.wind_gust))).toBe(true)
    expect(resolveRenderableRasterLayer(activeRun, 'wind_speed')).toBeNull()
    expect(resolveRenderableRasterLayer(activeRun, 'wind_gust')).toMatchObject({
      layer: { id: 'wind_gust' },
      artifact: { id: 'gust_surface' },
    })
  })

  it('rejects catalog layers backed by non-scalar artifacts', () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: {
          ...createVectorArtifactFixture(),
          id: 'tmp_surface',
        },
      },
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    })

    expect(() => resolveRenderableRasterLayer(createActiveRunFixture(manifest), 'temperature')).toThrow(
      'Layer temperature requires scalar artifact tmp_surface, got vector'
    )
  })

  it('uses direct scalar precipitation rate source', () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({
          id: 'prate_surface',
          units: 'kg m^-2 s^-1',
          parameter: 'prate',
        }),
      },
    })

    const precipLayer = requireRasterLayer(FORECAST_RASTER_LAYERS_BY_ID.precipitation_rate)
    const activeRun = createActiveRunFixture(manifest)

    expect(precipLayer.source).toMatchObject({
      artifactId: 'prate_surface',
      bands: [{ id: 'value' }],
    })
    expect(precipLayer.overlays).toEqual([{
      id: 'precipitation_type',
      style: 'precipitation-type-pattern',
      source: {
        artifactId: 'precip_type_surface',
        bands: [{ id: 'snow_frac' }, { id: 'mix_frac' }],
      },
      optional: true,
    }])
    expect(OVERLAY_LAYERS.map((overlay) => overlay.id)).toContain('precipitation_type')
    expect(isLayerAvailableForActiveRun(activeRun, precipLayer)).toBe(true)
    const resolved = resolveRenderableRasterLayer(activeRun, 'precipitation_rate')
    expect(resolved).toMatchObject({
      layer: { id: 'precipitation_rate' },
      artifact: { units: 'kg m^-2 s^-1', parameter: 'prate' },
    })
  })
})
