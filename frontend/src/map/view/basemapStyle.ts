import type { LayerSpecification, StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'

import type { WeatherMapConfig } from '../../config'
import { joinUrl } from '../../url/joinUrl'
import { BASEMAP_SOURCE_ID } from './constants'
import styleJson from './style.json'

export type BasemapPaintValue = string | number | boolean | readonly unknown[]

export type BasemapPaintKey = {
  layerId: string
  property: string
}

export type BasemapPaint = BasemapPaintKey & {
  value: BasemapPaintValue
}

function cloneMapStyle(style: StyleSpecification): StyleSpecification {
  const structuredCloneFn =
    globalThis.structuredClone as ((value: StyleSpecification) => StyleSpecification) | undefined

  return typeof structuredCloneFn === 'function'
    ? structuredCloneFn(style)
    : JSON.parse(JSON.stringify(style)) as StyleSpecification
}

export function buildMapStyle(config: WeatherMapConfig): StyleSpecification {
  const style = cloneMapStyle(styleJson as unknown as StyleSpecification)

  style.glyphs = joinUrl(config.artifactBaseUrl, 'glyphs/{fontstack}/{range}.pbf')

  if (!config.basemapUrl) {
    delete style.sources[BASEMAP_SOURCE_ID]
    style.layers = (style.layers ?? []).filter((layer) => !usesBasemapSource(layer))
    return style
  }

  const source = style.sources[BASEMAP_SOURCE_ID] as VectorSourceSpecification
  source.url = config.basemapUrl

  return style
}

function usesBasemapSource(layer: LayerSpecification): boolean {
  return 'source' in layer && layer.source === BASEMAP_SOURCE_ID
}

export function readStandardBasemapPaints(keys: readonly BasemapPaintKey[]): BasemapPaint[] {
  return keys.map((key) => ({
    ...key,
    value: readStandardBasemapPaintValue(key),
  }))
}

export function readStandardBasemapPaintValue({
  layerId,
  property,
}: BasemapPaintKey): BasemapPaintValue {
  const style = styleJson as unknown as StyleSpecification
  const layer = (style.layers ?? []).find((candidate) => candidate.id === layerId)
  if (!layer) {
    throw new Error(`Missing basemap style layer ${layerId}`)
  }

  const paint = 'paint' in layer
    ? layer.paint as Record<string, BasemapPaintValue> | undefined
    : undefined
  if (!paint || !(property in paint)) {
    throw new Error(`Missing basemap style paint ${layerId}.${property}`)
  }

  return clonePaintValue(paint[property]!)
}

function clonePaintValue(value: BasemapPaintValue): BasemapPaintValue {
  return Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) as BasemapPaintValue
    : value
}
