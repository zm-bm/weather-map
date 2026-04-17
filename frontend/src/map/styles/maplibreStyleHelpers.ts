import type {
  RasterSourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'

import { joinUrl } from '../../url/joinUrl'

export function cloneStyle(style: StyleSpecification): StyleSpecification {
  const clone = globalThis.structuredClone as ((value: StyleSpecification) => StyleSpecification) | undefined
  if (typeof clone === 'function') return clone(style)
  return JSON.parse(JSON.stringify(style)) as StyleSpecification
}

export function setGlyphUrl(style: StyleSpecification, serverUrl: string): void {
  style.glyphs = joinUrl(serverUrl, 'font/{fontstack}/{range}')
}

export function setVectorTiles(
  style: StyleSpecification,
  sourceId: string,
  tiles: string[]
): void {
  const source = style.sources?.[sourceId]
  if (!source || source.type !== 'vector') return
  ;(source as VectorSourceSpecification).tiles = tiles
}

export function setRasterTiles(
  style: StyleSpecification,
  sourceId: string,
  tiles: string[]
): void {
  const source = style.sources?.[sourceId]
  if (!source || source.type !== 'raster') return
  ;(source as RasterSourceSpecification).tiles = tiles
}

export function setRasterSourceMaxzoom(
  style: StyleSpecification,
  sourceId: string,
  maxzoom: number
): void {
  const source = style.sources?.[sourceId]
  if (!source || source.type !== 'raster') return
  ;(source as RasterSourceSpecification).maxzoom = maxzoom
}

export function setVectorSourceMaxzoom(
  style: StyleSpecification,
  sourceId: string,
  maxzoom: number
): void {
  const source = style.sources?.[sourceId]
  if (!source || source.type !== 'vector') return
  ;(source as VectorSourceSpecification).maxzoom = maxzoom
}

export function mergeSources(
  style: StyleSpecification,
  sources: NonNullable<StyleSpecification['sources']>
): void {
  style.sources = {
    ...(style.sources ?? {}),
    ...sources,
  } as StyleSpecification['sources']
}

export function insertLayersAfter(
  style: StyleSpecification,
  afterLayerId: string,
  layersToInsert: NonNullable<StyleSpecification['layers']>
): void {
  const existingLayers = style.layers ?? []
  const afterIndex = existingLayers.findIndex((layer) => layer.id === afterLayerId)
  const insertIndex = afterIndex >= 0 ? afterIndex + 1 : existingLayers.length
  style.layers = [
    ...existingLayers.slice(0, insertIndex),
    ...layersToInsert,
    ...existingLayers.slice(insertIndex),
  ] as StyleSpecification['layers']
}

export function setLocalizedTextField(
  style: StyleSpecification,
  layerId: string,
  language: string
): void {
  const layer = (style.layers ?? []).find((candidate) => candidate.id === layerId)
  if (!layer || layer.type !== 'symbol') return

  const symbolLayer = layer as SymbolLayerSpecification
  symbolLayer.layout = symbolLayer.layout ?? {}
  symbolLayer.layout['text-field'] = [
    'coalesce',
    ['get', `name:${language}`],
    ['get', 'name:en'],
    ['get', 'name'],
  ]
}
