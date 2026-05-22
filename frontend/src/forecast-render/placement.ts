import type { Map as MapLibreMap } from 'maplibre-gl'

import { FORECAST_OVERLAY_ANCHOR_LAYER_ID } from '../map/view/constants'

export const FORECAST_LAYER_BEFORE_ID = FORECAST_OVERLAY_ANCHOR_LAYER_ID

export function resolveForecastLayerBeforeId(map: MapLibreMap): string | undefined {
  return map.getLayer(FORECAST_LAYER_BEFORE_ID) ? FORECAST_LAYER_BEFORE_ID : undefined
}
