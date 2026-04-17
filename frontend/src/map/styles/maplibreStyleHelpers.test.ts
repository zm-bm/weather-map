import type { SymbolLayerSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { mapStyleTemplate } from './mapStyleTemplate'
import {
  cloneStyle,
  insertLayersAfter,
  mergeSources,
  setGlyphUrl,
  setLocalizedTextField,
  setVectorTiles,
} from './maplibreStyleHelpers'

describe('maplibreStyleHelpers', () => {
  it('clones style deeply without mutating template', () => {
    const cloned = cloneStyle(mapStyleTemplate)
    ;(cloned.sources?.basemap as VectorSourceSpecification).tiles = ['http://localhost:8081/basemap/{z}/{x}/{y}']

    expect(cloned).not.toBe(mapStyleTemplate)
    expect((mapStyleTemplate.sources?.basemap as VectorSourceSpecification).tiles).toEqual([])
  })

  it('sets glyph URL and vector source tiles', () => {
    const style = cloneStyle(mapStyleTemplate)
    setGlyphUrl(style, 'http://localhost:8081/')
    setVectorTiles(style, 'basemap', ['http://localhost:8081/basemap/{z}/{x}/{y}'])

    expect(style.glyphs).toBe('http://localhost:8081/font/{fontstack}/{range}')
    expect((style.sources?.basemap as VectorSourceSpecification).tiles).toEqual([
      'http://localhost:8081/basemap/{z}/{x}/{y}',
    ])
  })

  it('merges sources and inserts layers after anchor or appends when missing', () => {
    const style = cloneStyle(mapStyleTemplate)
    mergeSources(style, {
      extra: { type: 'raster', tiles: ['http://localhost:8081/extra/{z}/{x}/{y}'], tileSize: 256 },
    })
    expect(style.sources?.extra).toBeDefined()

    insertLayersAfter(style, 'water-fill', [{ id: 'custom-after', type: 'background' }])
    const firstIds = (style.layers ?? []).map((layer) => layer.id)
    expect(firstIds.indexOf('custom-after')).toBeGreaterThan(firstIds.indexOf('water-fill'))

    insertLayersAfter(style, 'missing-anchor', [{ id: 'custom-tail', type: 'background' }])
    const lastLayerId = style.layers?.[style.layers.length - 1]?.id
    expect(lastLayerId).toBe('custom-tail')
  })

  it('sets localized text fields for symbol layers', () => {
    const style = cloneStyle(mapStyleTemplate)
    setLocalizedTextField(style, 'place-country', 'es')

    const layer = style.layers?.find((candidate) => candidate.id === 'place-country') as SymbolLayerSpecification | undefined
    expect(layer?.layout?.['text-field']).toEqual([
      'coalesce',
      ['get', 'name:es'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ])
  })
})
