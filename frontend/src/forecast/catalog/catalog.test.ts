import { describe, expect, it } from 'vitest'

import { parseForecastCatalog } from './catalog'

const BASE_CATALOG = {
  catalogVersion: 'forecast-catalog-v1',
  groups: [
    {
      id: 'temperature',
      label: 'Temperature',
      defaultLayer: 'temperature',
      layers: ['temperature'],
    },
  ],
  layers: [
    {
      id: 'temperature',
      label: 'Temperature',
      groupId: 'temperature',
      paletteId: 'temperature.air.c.v1',
      displayRange: { min: -35, max: 50 },
      unitBehavior: 'temperature',
      legendScale: 'temperature',
      source: {
        kind: 'artifact',
        artifactId: 'tmp_surface',
      },
    },
  ],
  particleLayers: [
    {
      id: 'wind',
      label: 'Wind',
      source: {
        kind: 'artifact',
        artifactId: 'wind10m_uv',
      },
    },
  ],
} as const

describe('parseForecastCatalog', () => {
  it('accepts catalog layers, groups, and particle layers', () => {
    const catalog = parseForecastCatalog(BASE_CATALOG)

    expect(catalog.layers[0]?.id).toBe('temperature')
    expect(catalog.groups[0]?.layers).toEqual(['temperature'])
    expect(catalog.particleLayers[0]?.source.artifactId).toBe('wind10m_uv')
  })

  it('rejects duplicate ids and broken group references', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      layers: [
        BASE_CATALOG.layers[0],
        {
          ...BASE_CATALOG.layers[0],
          groupId: 'missing_group',
        },
      ],
    })).toThrow(/duplicate layer id temperature/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      groups: [
        {
          ...BASE_CATALOG.groups[0],
          layers: ['missing_layer'],
        },
      ],
    })).toThrow(/group temperature references missing layer missing_layer/)
  })

  it('rejects invalid display ranges and unknown source kinds', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      layers: [
        {
          ...BASE_CATALOG.layers[0],
          displayRange: { min: 10, max: 10 },
        },
      ],
    })).toThrow(/display range max must be greater than min/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      layers: [
        {
          ...BASE_CATALOG.layers[0],
          source: {
            kind: 'unknown',
            artifactId: 'tmp_surface',
          },
        },
      ],
    })).toThrow()
  })

  it('rejects unknown palette ids and legend scales', () => {
    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      layers: [
        {
          ...BASE_CATALOG.layers[0],
          paletteId: 'missing.palette.v1',
        },
      ],
    })).toThrow(/references unknown palette missing\.palette\.v1/)

    expect(() => parseForecastCatalog({
      ...BASE_CATALOG,
      layers: [
        {
          ...BASE_CATALOG.layers[0],
          legendScale: 'missing-scale',
        },
      ],
    })).toThrow(/references unknown legend scale missing-scale/)
  })
})
