import { describe, expect, it } from 'vitest'

import { parseForecastCatalog } from './schema'

const BASE_CATALOG = {
  catalogVersion: 'forecast-catalog-v1',
  rasterLayerGroups: [
    {
      id: 'temperature',
      label: 'Temperature',
      rasterLayerIds: ['temperature'],
    },
  ],
  rasterLayers: [
    {
      id: 'temperature',
      groupId: 'temperature',
      displayProfile: 'temperature',
      source: {
        artifactId: 'tmp_surface',
        bands: [{ id: 'value' }],
      },
    },
  ],
  particleLayers: [
    {
      id: 'wind',
      label: 'Wind',
      source: {
        artifactId: 'wind10m_uv',
        bands: [{ id: 'u' }, { id: 'v' }],
      },
    },
  ],
  contourLayers: [
    {
      id: 'pressure_contours',
      label: 'Pressure Contours',
      source: {
        artifactId: 'prmsl_msl',
        bands: [{ id: 'value' }],
      },
    },
  ],
  overlayLayers: [
    {
      id: 'precipitation_type',
      style: 'precipitation-type-pattern',
      source: {
        artifactId: 'precip_type_surface',
        bands: [{ id: 'snow_frac' }, { id: 'mix_frac' }],
      },
      optional: true,
    },
  ],
} as const

const STALE_UNIT_PROFILE_KEY = 'unit' + 'Profile'
const STALE_LEGEND_PROFILE_KEY = 'legend' + 'Profile'
const STALE_PALETTE_ID_KEY = 'palette' + 'Id'

describe('parseForecastCatalog', () => {
  it('accepts raster layers, raster layer groups, contour layers, and particle layers', () => {
    const catalog = parseForecastCatalog(BASE_CATALOG)

    expect(catalog.rasterLayers[0]?.id).toBe('temperature')
    expect(catalog.rasterLayers[0]?.displayProfile).toBe('temperature')
    expect(catalog.rasterLayers[0]?.source.bands).toEqual([{ id: 'value' }])
    expect(catalog.rasterLayerGroups[0]?.rasterLayerIds).toEqual(['temperature'])
    expect(catalog.contourLayers[0]?.source.bands.map((band) => band.id)).toEqual(['value'])
    expect(catalog.particleLayers[0]?.source.bands.map((band) => band.id)).toEqual(['u', 'v'])
    expect(catalog.overlayLayers[0]?.source.bands.map((band) => band.id)).toEqual(['snow_frac', 'mix_frac'])
  })

  it('rejects stale root, group, and raster-layer shape', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      groups: BASE_CATALOG.rasterLayerGroups,
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      layers: BASE_CATALOG.rasterLayers,
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayerGroups: [{
        ...BASE_CATALOG.rasterLayerGroups[0],
        defaultLayer: 'temperature',
      }],
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayerGroups: [{
        ...BASE_CATALOG.rasterLayerGroups[0],
        layers: ['temperature'],
      }],
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [{
        ...BASE_CATALOG.rasterLayers[0],
        display: {
          label: 'Temperature',
          range: { min: -35, max: 50 },
          [STALE_UNIT_PROFILE_KEY]: 'temperature',
          [STALE_LEGEND_PROFILE_KEY]: 'temperature',
        },
      }],
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [{
        ...BASE_CATALOG.rasterLayers[0],
        [STALE_UNIT_PROFILE_KEY]: 'temperature',
      }],
    })).toThrow(/Unrecognized key/)
  })

  it('rejects unknown display profiles and stale source palette metadata', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [{
        ...BASE_CATALOG.rasterLayers[0],
        displayProfile: 'missing-profile',
      }],
    })).toThrow(/Invalid option/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [{
        ...BASE_CATALOG.rasterLayers[0],
        source: {
          artifactId: 'tmp_surface',
          bands: [{ id: 'value', [STALE_PALETTE_ID_KEY]: 'temperature.air.c.v1' }],
        },
      }],
    })).toThrow(/Unrecognized key/)
  })

  it('accepts top-level overlay references and rejects invalid overlay metadata', () => {
    expect(parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          overlays: ['precipitation_type'],
        },
      ],
    }).rasterLayers[0]?.overlays?.[0]).toBe('precipitation_type')

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      overlayLayers: [
        {
          ...BASE_CATALOG.overlayLayers[0],
          source: {
            artifactId: 'precip_type_surface',
            bands: [],
          },
        },
      ],
    })).toThrow(/bands/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      overlayLayers: [
        {
          ...BASE_CATALOG.overlayLayers[0],
          style: 'unsupported-overlay-style',
        },
      ],
    })).toThrow(/precipitation-type-pattern/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          overlays: ['missing_overlay'],
        },
      ],
    })).toThrow(/references missing overlay missing_overlay/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      overlayLayers: [
        BASE_CATALOG.overlayLayers[0],
        {
          ...BASE_CATALOG.overlayLayers[0],
        },
      ],
    })).toThrow(/duplicate overlay layer id precipitation_type/)
  })

  it('rejects independent render layers without source bands or with stale bandIds', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      particleLayers: [{
        id: 'wind',
        label: 'Wind',
        source: {
          artifactId: 'wind10m_uv',
          bands: [],
        },
      }],
    })).toThrow(/bands/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      contourLayers: [{
        id: 'pressure_contours',
        label: 'Pressure Contours',
        source: {
          artifactId: 'prmsl_msl',
          bandIds: ['value'],
        },
      }],
    })).toThrow(/Unrecognized key/)
  })

  it('rejects duplicate ids and broken group references', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        BASE_CATALOG.rasterLayers[0],
        {
          ...BASE_CATALOG.rasterLayers[0],
          groupId: 'missing_group',
        },
      ],
    })).toThrow(/duplicate raster layer id temperature/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayerGroups: [
        {
          ...BASE_CATALOG.rasterLayerGroups[0],
          rasterLayerIds: ['missing_layer'],
        },
      ],
    })).toThrow(/group temperature references missing layer missing_layer/)
  })

  it('accepts multi-band sources and rejects stale band input metadata', () => {
    expect(parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          source: {
            artifactId: 'wind10m_uv',
            bands: [{ id: 'u' }, { id: 'v' }],
          },
        },
      ],
    }).rasterLayers[0]?.source.bands.map((band) => band.id)).toEqual(['u', 'v'])

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          source: {
            artifactId: 'wind10m_uv',
            bands: [{
              id: 'speed',
              input: { kind: 'wind-speed', u: 'u', v: 'v' },
            }],
          },
        },
      ],
    })).toThrow(/Unrecognized key/)
  })
})
