import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderData } from '../forecast-data'

export const FORECAST_LAYER_BEFORE_ID = 'background' as const

export type ForecastRenderHost = {
  version: number
  apply: (data: ForecastRenderData) => void
}

export type ForecastRendererId = 'field' | 'field-overlay' | 'contour-overlay' | 'particles'

export type ForecastRenderProfile = {
  key: string
  rendererIds: readonly ForecastRendererId[]
}

export const DEFAULT_FORECAST_RENDER_PROFILE = {
  key: 'default',
  rendererIds: ['field', 'field-overlay', 'particles'],
} as const satisfies ForecastRenderProfile

export type ForecastRenderer = {
  id: ForecastRendererId
  layerId: string
  install: (map: MapLibreMap) => void
  uninstall?: (map: MapLibreMap) => void
  apply: (map: MapLibreMap, data: ForecastRenderData) => void
}
