import type { Map as MapLibreMap } from 'maplibre-gl'

export const FORECAST_LAYER_BEFORE_ID = 'background' as const

export type ForecastLayer = {
  layerId: string
  install: (map: MapLibreMap) => void
}
