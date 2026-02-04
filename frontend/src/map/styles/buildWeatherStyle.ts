import type { StyleSpecification, SymbolLayerSpecification, VectorSourceSpecification } from 'maplibre-gl'

import type { CycleManifest } from '../../api/manifests'
import { baseStyleTemplate } from './baseStyle'
import { structuredClone } from '../../utils/structuredClone'
import {
	getWeatherLayerId,
	getWeatherSourceId,
	resolveWeatherWindow,
} from '../weatherWindow'
import type { WeatherMapConfig } from '../../config'
import { getTilesUrl } from '../tileServer'

export function buildBaseStyle(cfg: WeatherMapConfig): StyleSpecification {
  const style = structuredClone(baseStyleTemplate)

  // hydrate glyph URLs
  style.glyphs = `${cfg.serverUrl}/font/{fontstack}/{range}`

  // hydrate vector tile endpoints
  const sources = style.sources ?? {}
  if (sources.openmaptiles)
    (sources.openmaptiles as VectorSourceSpecification).tiles = [getTilesUrl(cfg.serverUrl, 'osm-planet')]
  if (sources.coastline)
    (sources?.coastline as VectorSourceSpecification).tiles = [getTilesUrl(cfg.serverUrl, 'coastline')]
  style.sources = sources

  // hydrate labels
  setLanguageTextField(style, 'place-country', cfg.language)
  setLanguageTextField(style, 'place-city', cfg.language)

  return style
}

export function buildWeatherStyle(
  manifest: CycleManifest,
  cfg: WeatherMapConfig,
  opts?: { activeLayer?: string; activeHour?: string; insertAfterLayerId?: string }
): StyleSpecification {
  const base = buildBaseStyle(cfg)

  const { layers } = manifest
  const hours = manifest.forecast_hours ?? []

  const activeLayer =
    (opts?.activeLayer && layers.includes(opts.activeLayer)) ? opts.activeLayer : layers[0]

  const window = resolveWeatherWindow(hours, opts?.activeHour) || { current: '000', prev: '000', next: '000' }

  const weatherSources = {
    [getWeatherSourceId(activeLayer, 'current')]: {
      type: 'raster',
      tiles: [getTilesUrl(cfg.serverUrl, `${manifest.cycle}.${activeLayer}.${window.current}`)],
      tileSize: 256,
      minzoom: manifest.min_zoom,
      maxzoom: manifest.max_zoom,
    },
    [getWeatherSourceId(activeLayer, 'prev')]: {
      type: 'raster',
      tiles: [getTilesUrl(cfg.serverUrl, `${manifest.cycle}.${activeLayer}.${window.prev}`)],
      tileSize: 256,
      minzoom: manifest.min_zoom,
      maxzoom: manifest.max_zoom,
    },
    [getWeatherSourceId(activeLayer, 'next')]: {
      type: 'raster',
      tiles: [getTilesUrl(cfg.serverUrl, `${manifest.cycle}.${activeLayer}.${window.next}`)],
      tileSize: 256,
      minzoom: manifest.min_zoom,
      maxzoom: manifest.max_zoom,
    },
  }

  const weatherLayers = [
    {
      id: getWeatherLayerId(activeLayer, 'prev'),
      type: 'raster',
      source: getWeatherSourceId(activeLayer, 'prev'),
      layout: { visibility: 'visible' },
      paint: { 'raster-opacity': 0 },
    },
    {
      id: getWeatherLayerId(activeLayer, 'next'),
      type: 'raster',
      source: getWeatherSourceId(activeLayer, 'next'),
      layout: { visibility: 'visible' },
      paint: { 'raster-opacity': 0 },
    },
    {
      id: getWeatherLayerId(activeLayer, 'current'),
      type: 'raster',
      source: getWeatherSourceId(activeLayer, 'current'),
      layout: { visibility: 'visible' },
      paint: { 'raster-opacity': 0.90 },
    },
  ]

  const baseLayers = base.layers ?? []
  const insertAfterId = opts?.insertAfterLayerId ?? 'water-fill'
  const insertIdx = baseLayers.findIndex((l) => l.id === insertAfterId)
  const mergedLayers =
    insertIdx >= 0
      ? [...baseLayers.slice(0, insertIdx + 1), ...weatherLayers, ...baseLayers.slice(insertIdx + 1)]
      : [...baseLayers, ...weatherLayers]

  return {
    ...base,
    sources: {
      ...(base.sources ?? {}),
      ...weatherSources,
    } as StyleSpecification['sources'],
    layers: mergedLayers as StyleSpecification['layers'],
  }
}

function setLanguageTextField(style: StyleSpecification, layerId: string, language: string) {
  const layers = style.layers ?? []
  const idx = layers.findIndex((l) => l.id === layerId)
  if (idx < 0) return
  const layer  = layers[idx]
  layer.layout = layer.layout ?? {}
  const symbolLayer = layer as SymbolLayerSpecification
  if (symbolLayer.layout) {
    symbolLayer.layout['text-field'] = ["coalesce", ["get", `name:${language}`], ["get", "name:latin"], ["get", "name"]]
  }
}
