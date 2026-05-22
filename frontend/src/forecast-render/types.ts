import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderData } from '../forecast-data'
import type { ForecastRenderSettings } from '../forecast-settings/settings'

export type ForecastRenderHost = {
  version: number
  apply: (data: ForecastRenderData) => void
}

export type ForecastRendererId = 'field' | 'cloud-layers' | 'field-overlay' | 'contour-overlay' | 'particles'

export type ForecastRenderProfile = {
  rendererIds: readonly ForecastRendererId[]
}

export type ForecastRenderer = {
  id: ForecastRendererId
  layerId: string
  install: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  uninstall?: (map: MapLibreMap) => void
  configure?: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  apply: (map: MapLibreMap, data: ForecastRenderData) => void
}
