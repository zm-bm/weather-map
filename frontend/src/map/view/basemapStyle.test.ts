import type { StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { createConfigFixture } from '@/test/fixtures'
import {
  BASEMAP_LAYER_IDS,
  BASEMAP_SOURCE_LAYER_IDS,
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
  it('builds a cloned style with the configured basemap source url', () => {
    const config = createConfigFixture()
    const style = buildMapStyle(config)

    expect(style).not.toBe(baseStyleJson)
    expect(style.glyphs).toBeUndefined()

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
    const layerIds = (style.layers ?? []).map((layer) => layer.id)

    for (const layerId of Object.values(BASEMAP_LAYER_IDS)) {
      expect(layers.has(layerId)).toBe(true)
    }
    expect(FORECAST_OVERLAY_ANCHOR_LAYER_ID).toBe(BASEMAP_LAYER_IDS.landcoverContext)
    expect(layerIds.indexOf(BASEMAP_LAYER_IDS.landcoverContext)).toBeLessThan(
      layerIds.indexOf(BASEMAP_LAYER_IDS.landuseContext),
    )
    expect(layerIds.indexOf(BASEMAP_LAYER_IDS.landuseContext)).toBeLessThan(
      layerIds.indexOf(BASEMAP_LAYER_IDS.coastlineShadow),
    )
    expect(layerIds.indexOf(BASEMAP_LAYER_IDS.coastlineShadow)).toBeLessThan(
      layerIds.indexOf(BASEMAP_LAYER_IDS.lakeFill),
    )
    expect(layerIds.indexOf(BASEMAP_LAYER_IDS.lakeFill)).toBeLessThan(
      layerIds.indexOf(BASEMAP_LAYER_IDS.coastline),
    )
    const landcoverLayer = layers.get(BASEMAP_LAYER_IDS.landcoverContext) as { maxzoom?: number } | undefined
    expect(landcoverLayer?.maxzoom).toBe(9)
    expect((layers.get(BASEMAP_LAYER_IDS.lakeFill) as { filter?: unknown } | undefined)?.filter).toEqual([
      'any',
      ['in', 'kind', 'lake', 'sea'],
      ['all', ['==', 'kind', 'water'], ['==', 'kind_detail', 'lake']],
    ])
    expect((layers.get(BASEMAP_LAYER_IDS.lakeOutline) as { filter?: unknown } | undefined)?.filter).toEqual([
      'any',
      ['==', 'kind', 'lake'],
      ['all', ['==', 'kind', 'water'], ['==', 'kind_detail', 'lake']],
    ])
    expect((style.layers ?? []).filter((layer) => layer.type === 'symbol')).toEqual([])

    const sourceLayers = new Set(Object.values(BASEMAP_SOURCE_LAYER_IDS))
    for (const layer of style.layers ?? []) {
      if ('source' in layer && layer.source === BASEMAP_SOURCE_ID) {
        expect(sourceLayers.has(layer['source-layer'] ?? '')).toBe(true)
      }
    }

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

  it('keeps the standard basemap quiet behind weather fields', () => {
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.earthMask,
      property: 'fill-color',
    })).toBe('rgb(240, 237, 230)')
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.water,
      property: 'fill-opacity',
    })).toBe(0.24)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.landuseContext,
      property: 'fill-antialias',
    })).toBe(false)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.landuseContext,
      property: 'fill-color',
    })).toBe('rgb(118, 132, 112)')
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.landuseContext,
      property: 'fill-opacity',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      4, 0.12,
      6, 0.22,
      8, 0.30,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.landcoverContext,
      property: 'fill-antialias',
    })).toBe(false)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.landcoverContext,
      property: 'fill-opacity',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      3, 0.08,
      6, 0.14,
      8, 0.18,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.coastlineShadow,
      property: 'line-opacity',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      0, 0.18,
      6, 0.32,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.coastlineShadow,
      property: 'line-width',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      0, 2.0,
      6, 3.6,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.coastlineShadow,
      property: 'line-blur',
    })).toBe(1.2)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.lakeFill,
      property: 'fill-opacity',
    })).toBe(0.28)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.lakeFill,
      property: 'fill-color',
    })).toBe('rgb(88, 148, 158)')
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.coastline,
      property: 'line-width',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      0, 0.75,
      4, 1.3,
      6, 1.55,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.coastline,
      property: 'line-opacity',
    })).toBe(0.88)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.lakeOutline,
      property: 'line-opacity',
    })).toBe(0.58)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.riverOutline,
      property: 'line-color',
    })).toBe('rgb(42, 110, 122)')
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.riverOutline,
      property: 'line-opacity',
    })).toBe(0.68)
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.riverOutline,
      property: 'line-width',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      1, 0.5,
      4, 0.78,
      6, 1.05,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.roadMajor,
      property: 'line-opacity',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      4, 0.18,
      5, 0.30,
      7, 0.46,
      10, 0.60,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.roadMajor,
      property: 'line-width',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      4, 0.45,
      5, 0.75,
      6, 1.05,
      10, 1.65,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.boundary2,
      property: 'line-opacity',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      0, 0.34,
      4, 0.52,
      10, 0.66,
    ])
    expect(readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.boundary4,
      property: 'line-opacity',
    })).toEqual([
      'interpolate', ['linear'], ['zoom'],
      4, 0.36,
      7, 0.48,
      11, 0.56,
      20, 0.62,
    ])
  })
})
