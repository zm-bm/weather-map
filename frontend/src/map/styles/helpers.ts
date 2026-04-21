import type {
  LayerSpecification,
  RasterDEMSourceSpecification,
  RasterSourceSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'

import type { WeatherMapConfig } from '../../config'
import { joinUrl } from '../../url/joinUrl'
import {
  buildNoiseLayer,
  buildNoiseSource,
  NOISE_LAYER_ID,
  NOISE_SOURCE_ID,
} from '../noise'
import baseStyleJson from './style.json'

const DEM_SOURCE_ID = 'dem-source' as const
const DEM_TILE_PATH = 'land-dem-z5/{z}/{x}/{y}' as const
const NOISE_INSERT_AFTER_LAYER_ID = 'background' as const

type TileSourceSpecification =
  | VectorSourceSpecification
  | RasterSourceSpecification
  | RasterDEMSourceSpecification

export function copyStyle(style: StyleSpecification): StyleSpecification {
  const clone = globalThis.structuredClone as ((value: StyleSpecification) => StyleSpecification) | undefined
  if (typeof clone === 'function') return clone(style)
  return JSON.parse(JSON.stringify(style)) as StyleSpecification
}

export function setSourceTiles(
  style: StyleSpecification,
  sourceId: string,
  tiles: string[]
): void {
  const source = style.sources?.[sourceId]
  if (!source) return
  (source as TileSourceSpecification).tiles = tiles
}

export function setSource(
  style: StyleSpecification,
  sourceId: string,
  source: NonNullable<StyleSpecification['sources']>[string]
): void {
  style.sources = {
    ...(style.sources ?? {}),
    [sourceId]: source,
  } as StyleSpecification['sources']
}

export function insertLayerAfter(
  style: StyleSpecification,
  afterLayerId: string,
  layerToInsert: LayerSpecification
): void {
  const existingLayers = style.layers ?? []
  const afterIndex = existingLayers.findIndex((layer) => layer.id === afterLayerId)
  const insertIndex = afterIndex >= 0 ? afterIndex + 1 : existingLayers.length
  style.layers = [
    ...existingLayers.slice(0, insertIndex),
    layerToInsert,
    ...existingLayers.slice(insertIndex),
  ] as StyleSpecification['layers']
}

export function buildMapStyle(config: WeatherMapConfig): StyleSpecification {
  const style = copyStyle(baseStyleJson as unknown as StyleSpecification)

  style.glyphs = joinUrl(config.serverUrl, 'font/{fontstack}/{range}')

  setSourceTiles(style, DEM_SOURCE_ID, [joinUrl(config.serverUrl, DEM_TILE_PATH)])
  setSource(style, NOISE_SOURCE_ID, buildNoiseSource())

  const hasNoiseLayer = (style.layers ?? []).some((layer) => layer.id === NOISE_LAYER_ID)
  if (!hasNoiseLayer) {
    insertLayerAfter(style, NOISE_INSERT_AFTER_LAYER_ID, buildNoiseLayer() as LayerSpecification)
  }

  return style
}
