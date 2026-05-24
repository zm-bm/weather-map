import type { StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { createConfigFixture } from '@/test/fixtures'
import { joinUrl } from '@/core/url/joinUrl'
import {
  BASEMAP_LAYER_IDS,
  BASEMAP_SOURCE_ID,
  FORECAST_OVERLAY_ANCHOR_LAYER_ID,
} from '../basemap'
import {
  BASEMAP_THEME_PAINT_KEYS,
} from './basemapTheme'
import {
  buildMapStyle,
  readStandardBasemapPaintValue,
} from './basemapStyle'
import baseStyleJson from './style.json'

describe('basemap style', () => {
  it('builds a cloned style with configured glyph and basemap source urls', () => {
    const config = createConfigFixture()
    const style = buildMapStyle(config)

    expect(style).not.toBe(baseStyleJson)
    expect(style.glyphs).toBe(joinUrl(config.artifactBaseUrl, 'glyphs/{fontstack}/{range}.pbf'))

    const basemapSource = style.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification | undefined
    expect(basemapSource?.type).toBe('vector')
    expect(basemapSource?.url).toBe(config.basemapUrl)

    ;(basemapSource as VectorSourceSpecification).tiles = ['http://localhost:3000/basemap/{z}/{x}/{y}']
    expect((baseStyleJson.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification).tiles).toBeUndefined()
  })

  it('omits the basemap source and dependent layers when no basemap url is configured', () => {
    const style = buildMapStyle({
      ...createConfigFixture(),
      basemapUrl: undefined,
    })

    expect(style.sources?.[BASEMAP_SOURCE_ID]).toBeUndefined()
    expect((style.layers ?? []).some((layer) => 'source' in layer && layer.source === BASEMAP_SOURCE_ID)).toBe(false)
    expect((style.layers ?? []).map((layer) => layer.id)).toEqual([BASEMAP_LAYER_IDS.background])
  })

  it('keeps basemap constants and themeable paint keys aligned with style.json', () => {
    const style = baseStyleJson as unknown as StyleSpecification
    const layers = new Map((style.layers ?? []).map((layer) => [layer.id, layer]))

    for (const layerId of Object.values(BASEMAP_LAYER_IDS)) {
      expect(layers.has(layerId)).toBe(true)
    }
    expect(FORECAST_OVERLAY_ANCHOR_LAYER_ID).toBe(BASEMAP_LAYER_IDS.coastline)

    for (const key of BASEMAP_THEME_PAINT_KEYS) {
      const layer = layers.get(key.layerId)
      expect(layer).toBeDefined()
      const paint = layer && 'paint' in layer
        ? layer.paint as Record<string, unknown> | undefined
        : undefined
      expect(paint?.[key.property]).toBeDefined()
    }
  })

  it('reads standard theme paint values from style.json', () => {
    const style = baseStyleJson as unknown as StyleSpecification
    const waterLayer = (style.layers ?? []).find((layer) => layer.id === BASEMAP_LAYER_IDS.water)
    const waterPaint = waterLayer && 'paint' in waterLayer
      ? waterLayer.paint as Record<string, unknown> | undefined
      : undefined

    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.water,
      property: 'fill-opacity',
    })).toBe(waterPaint?.['fill-opacity'])
  })
})
