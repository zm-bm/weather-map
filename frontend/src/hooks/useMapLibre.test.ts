import type {
  SymbolLayerSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { NOISE_LAYER_ID, NOISE_SOURCE_ID } from '../map/noise'
import { createConfigFixture } from '../test/fixtures'
import { buildInitialMapStyle } from './useMapLibre'

describe('buildInitialMapStyle', () => {
  it('hydrates glyph URL and vector tile sources', () => {
    const style = buildInitialMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))

    expect(style.glyphs).toBe('http://localhost:8081/font/{fontstack}/{range}')
    expect((style.sources?.basemap as VectorSourceSpecification).tiles).toEqual([
      'http://localhost:8081/basemap-vector/{z}/{x}/{y}',
    ])
    expect((style.sources?.coastline as VectorSourceSpecification).tiles).toEqual([
      'http://localhost:8081/coastline-simplified/{z}/{x}/{y}',
    ])
    expect((style.sources?.['lake-shoreline'] as VectorSourceSpecification).tiles).toEqual([
      'http://localhost:8081/lake-shoreline/{z}/{x}/{y}',
    ])
    expect((style.sources?.basemap as VectorSourceSpecification).maxzoom).toBe(6)
    expect((style.sources?.coastline as VectorSourceSpecification).maxzoom).toBe(9)
    expect((style.sources?.['lake-shoreline'] as VectorSourceSpecification).maxzoom).toBe(9)
  })

  it('includes noise source and layer in constructor style', () => {
    const style = buildInitialMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))

    expect(style.sources?.[NOISE_SOURCE_ID]).toBeDefined()
    const layerIds = (style.layers ?? []).map((layer) => layer.id)
    expect(layerIds).toContain(NOISE_LAYER_ID)
  })

  it('includes the reset vector basemap layers in constructor style', () => {
    const style = buildInitialMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))
    const layerIds = (style.layers ?? []).map((layer) => layer.id)

    expect(layerIds).toContain('coast-outline')
    expect(layerIds).toContain('boundary-land-level-2')
    expect(layerIds).toContain('highway')
    expect(layerIds).toContain('place-country')
  })

  it('hydrates localized symbol label text-field expressions', () => {
    const style = buildInitialMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'fr' }))

    const placeCountry = style.layers?.find((layer) => layer.id === 'place-country') as SymbolLayerSpecification | undefined
    const placeCity = style.layers?.find((layer) => layer.id === 'place-city') as SymbolLayerSpecification | undefined

    expect(placeCountry?.layout?.['text-field']).toEqual([
      'coalesce',
      ['get', 'name:fr'],
      ['get', 'name:en'],
      ['get', 'name'],
    ])
    expect(placeCity?.layout?.['text-field']).toEqual([
      'coalesce',
      ['get', 'name:fr'],
      ['get', 'name:en'],
      ['get', 'name'],
    ])
  })
})
