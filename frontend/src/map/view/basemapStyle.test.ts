import type { RasterSourceSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { createConfigFixture } from '@/test/fixtures'
import {
  BASEMAP_LAYER_IDS,
  BASEMAP_SOURCE_ID,
  SATELLITE_BASEMAP_SOURCE_ID,
} from '../basemap'
import {
  buildMapStyle,
  readStandardBasemapPaintValue,
} from './basemapStyle'
import baseStyleJson from './style.json'

describe('basemap style', () => {
  it('builds a cloned style with the configured basemap source url', () => {
    const config = createConfigFixture()
    const style = buildMapStyle(config)

    expect(style).not.toBe(baseStyleJson)
    expect(style.glyphs).toBeUndefined()

    const basemapSource = style.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification | undefined
    expect(basemapSource?.type).toBe('vector')
    expect(basemapSource?.url).toBe(config.basemapUrl)

    const satelliteSource = style.sources?.[SATELLITE_BASEMAP_SOURCE_ID] as RasterSourceSpecification | undefined
    expect(satelliteSource?.type).toBe('raster')
    expect(satelliteSource?.tiles?.[0]).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'
    )
    expect(satelliteSource?.attribution).toBe(
      '<a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api">NASA GIBS</a> / ESDIS'
    )

    ;(basemapSource as VectorSourceSpecification).tiles = ['http://localhost:3000/basemap/{z}/{x}/{y}']
    expect((baseStyleJson.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification).tiles).toBeUndefined()
  })

  it('omits the basemap source and dependent layers when no basemap url is configured', () => {
    const style = buildMapStyle({
      ...createConfigFixture(),
      basemapUrl: undefined,
    })

    expect(style.sources?.[BASEMAP_SOURCE_ID]).toBeUndefined()
    expect(style.sources?.[SATELLITE_BASEMAP_SOURCE_ID]).toBeDefined()
    expect((style.layers ?? []).some((layer) => 'source' in layer && layer.source === BASEMAP_SOURCE_ID)).toBe(false)
    expect((style.layers ?? []).map((layer) => layer.id)).toEqual([
      BASEMAP_LAYER_IDS.background,
      BASEMAP_LAYER_IDS.satelliteBasemap,
    ])
  })

  it('reads cloned standard paint values from style.json', () => {
    const paintValue = readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.roadMajor,
      property: 'line-opacity',
    })
    expect(Array.isArray(paintValue)).toBe(true)

    ;(paintValue as unknown[]).push('mutated')

    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.roadMajor,
      property: 'line-opacity',
    })).not.toContain('mutated')
  })

  it('throws when a standard paint value cannot be read', () => {
    expect(() => readStandardBasemapPaintValue({
      layerId: 'missing_layer',
      property: 'line-color',
    })).toThrow('Missing basemap style layer missing_layer')

    expect(() => readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.background,
      property: 'line-color',
    })).toThrow(`Missing basemap style paint ${BASEMAP_LAYER_IDS.background}.line-color`)
  })
})
