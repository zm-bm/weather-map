import type {
  RasterDEMSourceSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { createConfigFixture } from '../../test/fixtures'
import { NOISE_LAYER_ID, NOISE_SOURCE_ID } from '../noise'
import baseStyleJson from './style.json'
import {
  buildMapStyle,
  copyStyle,
  insertLayerAfter,
  setSource,
  setSourceTiles,
} from './helpers'

describe('helpers', () => {
  const baseStyle = baseStyleJson as StyleSpecification

  it('clones style deeply without mutating template', () => {
    const cloned = copyStyle(baseStyle)
    ;(cloned.sources?.openmaptiles as VectorSourceSpecification).tiles = [
      'http://localhost:8081/basemap/{z}/{x}/{y}',
    ]

    expect(cloned).not.toBe(baseStyle)
    expect((baseStyle.sources?.openmaptiles as VectorSourceSpecification).tiles).toBeUndefined()
  })

  it('sets source tiles', () => {
    const style = copyStyle(baseStyle)
    setSourceTiles(style, 'dem-source', ['http://localhost:8081/terrain/{z}/{x}/{y}'])

    expect((style.sources?.['dem-source'] as RasterDEMSourceSpecification).tiles).toEqual([
      'http://localhost:8081/terrain/{z}/{x}/{y}',
    ])
  })

  it('sets sources and inserts layers after anchor or appends when missing', () => {
    const style = copyStyle(baseStyle)
    setSource(style, 'extra', {
      type: 'raster',
      tiles: ['http://localhost:8081/extra/{z}/{x}/{y}'],
      tileSize: 256,
    })
    expect(style.sources?.extra).toBeDefined()

    insertLayerAfter(style, 'water', { id: 'custom-after', type: 'background' })
    const firstIds = (style.layers ?? []).map((layer) => layer.id)
    expect(firstIds.indexOf('custom-after')).toBeGreaterThan(firstIds.indexOf('water'))

    insertLayerAfter(style, 'missing-anchor', { id: 'custom-tail', type: 'background' })
    const lastLayerId = style.layers?.[style.layers.length - 1]?.id
    expect(lastLayerId).toBe('custom-tail')
  })

  it('builds the map style with hydrated runtime sources', () => {
    const style = buildMapStyle(createConfigFixture({ serverUrl: 'http://localhost:8081/', language: 'es' }))

    expect(style.glyphs).toBe('http://localhost:8081/font/{fontstack}/{range}')
    expect((style.sources?.['dem-source'] as RasterDEMSourceSpecification).tiles).toEqual([
      'http://localhost:8081/land-dem-z5/{z}/{x}/{y}',
    ])
    expect(style.sources?.[NOISE_SOURCE_ID]).toBeDefined()
    expect((style.layers ?? []).some((layer) => layer.id === NOISE_LAYER_ID)).toBe(true)
  })
})
