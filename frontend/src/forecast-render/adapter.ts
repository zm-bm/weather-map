import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderData } from '../forecast-data'
import type { ForecastRenderSettings } from '../forecast-settings/settings'
import type { ForecastRendererId } from './types'

export type RenderAdapter = {
  id: ForecastRendererId
  layerId: string
  install: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  uninstall?: (map: MapLibreMap) => void
  configure?: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  apply: (map: MapLibreMap, data: ForecastRenderData) => void
}
