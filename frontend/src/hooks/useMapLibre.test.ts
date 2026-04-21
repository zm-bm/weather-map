import type {
  RasterDEMSourceSpecification,
  SymbolLayerSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { NOISE_LAYER_ID, NOISE_SOURCE_ID } from '../map/noise'
import { buildMapStyle } from '../map/styles/helpers'
import { createConfigFixture } from '../test/fixtures'

describe('buildMapStyle', () => {
  it('hydrates glyph URL and preserves the imported style sources', () => {
    const style = buildMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))

    expect(style.glyphs).toBe('http://localhost:8081/font/{fontstack}/{range}')
    const openMapTilesSource = style.sources?.openmaptiles as VectorSourceSpecification | undefined
    expect(openMapTilesSource?.type).toBe('vector')
    expect(openMapTilesSource?.url).toBe('https://tiles.openfreemap.org/planet')
    const demSource = style.sources?.['dem-source'] as RasterDEMSourceSpecification | undefined
    expect(demSource?.type).toBe('raster-dem')
    expect(demSource?.encoding).toBe('terrarium')
    expect(demSource?.tiles).toEqual(['http://localhost:8081/land-dem/{z}/{x}/{y}'])
    expect(demSource?.maxzoom).toBe(5)
    expect(style.terrain).toBeUndefined()
  })

  it('includes noise source and layer in constructor style', () => {
    const style = buildMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))

    expect(style.sources?.[NOISE_SOURCE_ID]).toBeDefined()
    const layerIds = (style.layers ?? []).map((layer) => layer.id)
    expect(layerIds).toContain(NOISE_LAYER_ID)
  })

  it('preserves the imported style layers alongside the noise overlay', () => {
    const style = buildMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))
    const layerIds = (style.layers ?? []).map((layer) => layer.id)

    expect(layerIds).toContain('background')
    expect(layerIds).toContain('hillshade')
    expect(layerIds).toContain('water')
    expect(layerIds).toContain('label_city_capital')
  })

  it('leaves missing reset-label ids untouched when the imported style does not include them', () => {
    const style = buildMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'fr' }))

    const placeCountry = style.layers?.find((layer) => layer.id === 'place-country') as SymbolLayerSpecification | undefined
    const placeCity = style.layers?.find((layer) => layer.id === 'place-city') as SymbolLayerSpecification | undefined

    expect(placeCountry).toBeUndefined()
    expect(placeCity).toBeUndefined()
  })
})
