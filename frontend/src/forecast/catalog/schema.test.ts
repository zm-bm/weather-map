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
      display: {
        label: 'Temperature',
        range: { min: -35, max: 50 },
        unitBehavior: 'temperature',
        legendScale: 'temperature',
      },
      source: {
        artifactId: 'tmp_surface',
        bands: [{ id: 'value', paletteId: 'temperature.air.c.v1' }],
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

describe('parseForecastCatalog', () => {
  it('accepts raster layers, raster layer groups, contour layers, and particle layers', () => {
    const catalog = parseForecastCatalog(BASE_CATALOG)

    expect(catalog.rasterLayers[0]?.id).toBe('temperature')
    expect(catalog.rasterLayers[0]?.display.label).toBe('Temperature')
    expect(catalog.rasterLayerGroups[0]?.rasterLayerIds).toEqual(['temperature'])
    expect(catalog.contourLayers[0]?.source.artifactId).toBe('prmsl_msl')
    expect(catalog.contourLayers[0]?.source.bands.map((band) => band.id)).toEqual(['value'])
    expect(catalog.particleLayers[0]?.source.artifactId).toBe('wind10m_uv')
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
        displayRange: { min: -35, max: 50 },
      }],
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [{
        ...BASE_CATALOG.rasterLayers[0],
        unitBehavior: 'temperature',
      }],
    })).toThrow(/Unrecognized key/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [{
        ...BASE_CATALOG.rasterLayers[0],
        legendScale: 'temperature',
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
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          overlays: [{
            id: 'precipitation_type',
            style: 'precipitation-type-pattern',
            artifactId: 'precip_type_surface',
          }],
        },
      ],
    })).toThrow(/expected string/)

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

  it('rejects invalid display ranges and invalid source shapes', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          display: {
            ...BASE_CATALOG.rasterLayers[0].display,
            range: { min: 10, max: 10 },
          },
        },
      ],
    })).toThrow(/display range max must be greater than min/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          source: {
            artifactId: 'tmp_surface',
          },
        },
      ],
    })).toThrow(/bands/)
  })

  it('accepts multi-band sources and rejects stale band input metadata', () => {
    expect(parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          source: {
            artifactId: 'wind10m_uv',
            bands: [
              { id: 'u', paletteId: 'wind.gust.mps.v1' },
              { id: 'v', paletteId: 'wind.gust.mps.v1' },
            ],
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
              paletteId: 'wind.gust.mps.v1',
              input: { kind: 'wind-speed', u: 'u', v: 'v' },
            }],
          },
        },
      ],
    })).toThrow(/Unrecognized key/)
  })

  it('rejects unknown palette ids and legend scales', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          source: {
            ...BASE_CATALOG.rasterLayers[0].source,
            bands: [{ id: 'value', paletteId: 'missing.palette.v1' }],
          },
        },
      ],
    })).toThrow(/references unknown palette missing\.palette\.v1/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      rasterLayers: [
        {
          ...BASE_CATALOG.rasterLayers[0],
          display: {
            ...BASE_CATALOG.rasterLayers[0].display,
            legendScale: 'missing-scale',
          },
        },
      ],
    })).toThrow(/references unknown legend scale missing-scale/)
  })
})
