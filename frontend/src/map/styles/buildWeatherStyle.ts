import type { StyleSpecification, SymbolLayerSpecification, VectorSourceSpecification } from 'maplibre-gl'

import type { CycleManifest } from '../../api/manifests'
import { baseStyleTemplate } from './baseStyle'
import { getWeatherLayerId, getWeatherSourceId } from './weatherIds'
import { structuredClone } from '../../utils/structuredClone'

type StyleConfig = {
  tilesUrl: string
  serverUrl: string
  language: string
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

export function buildBaseStyle(cfg: StyleConfig): StyleSpecification {
  const style = structuredClone(baseStyleTemplate)

  // hydrate sprite and glyph URLs
  style.sprite = `${cfg.tilesUrl}/styles/weather-map/sprite`
  style.glyphs = `${cfg.tilesUrl}/fonts/{fontstack}/{range}.pbf`

  // hydrate vector tile endpoints
  const sources = style.sources ?? {}
  if (sources.openmaptiles)
    (sources.openmaptiles as VectorSourceSpecification).tiles = [`${cfg.tilesUrl}/data/openmaptiles/{z}/{x}/{y}.pbf`]
  if (sources.coastline)
    (sources?.coastline as VectorSourceSpecification).tiles = [`${cfg.tilesUrl}/data/coastline/{z}/{x}/{y}.pbf`]
  style.sources = sources

  // hydrate labels
  setLanguageTextField(style, 'place-country', cfg.language)
  setLanguageTextField(style, 'place-city', cfg.language)

  return style
}

export function buildWeatherStyle(
  manifest: CycleManifest,
  cfg: StyleConfig,
  opts?: { activeLayer?: string; insertAfterLayerId?: string }
): StyleSpecification {
  const base = buildBaseStyle(cfg)

  const { layers } = manifest

  const activeLayer =
    (opts?.activeLayer && layers.includes(opts.activeLayer)) ? opts.activeLayer : layers[0]

  const baseWeatherUrl = `${cfg.serverUrl}/tiles/${manifest.cycle}/${activeLayer}`

  const weatherSources = Object.fromEntries(
    manifest.forecast_hours.map((hour) => [
      getWeatherSourceId(activeLayer, hour),
      {
        type: "raster",
        tiles: [`${baseWeatherUrl}/${hour}/{z}/{x}/{y}.png`],
        tileSize: 256,
        minzoom: manifest.min_zoom,
        maxzoom: manifest.max_zoom,
      },
    ])
  )

  const weatherLayers = manifest.forecast_hours.map((hour, idx) => ({
    id: getWeatherLayerId(activeLayer, hour),
    type: "raster",
    source: getWeatherSourceId(activeLayer, hour),
    layout: { visibility: idx === 0 ? "visible" : "none" },
    paint: { "raster-opacity": 0.90 },
  }))

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
