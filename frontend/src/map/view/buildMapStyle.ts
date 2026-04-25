import type { LayerSpecification, StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'

import type { WeatherMapConfig } from '../../config'
import { joinUrl } from '../../url/joinUrl'
import { BASEMAP_SOURCE_ID } from './constants'
import styleJson from './style.json'

function cloneMapStyle(style: StyleSpecification): StyleSpecification {
  const structuredCloneFn =
    globalThis.structuredClone as ((value: StyleSpecification) => StyleSpecification) | undefined

  return typeof structuredCloneFn === 'function'
    ? structuredCloneFn(style)
    : JSON.parse(JSON.stringify(style)) as StyleSpecification
}

export function buildMapStyle(config: WeatherMapConfig): StyleSpecification {
  const style = cloneMapStyle(styleJson as unknown as StyleSpecification)

  style.glyphs = joinUrl(config.frontendBaseUrl, 'glyphs/{fontstack}/{range}.pbf')

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
