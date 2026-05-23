import type { Map as MapLibreMap } from 'maplibre-gl'

import type { RenderAdapter } from '../adapter'
import {
  createCustomLayer,
  resolveForecastLayerBeforeId,
} from '../layer'
import { createFieldOverlayRuntime } from './engine/runtime'
import { getFieldOverlayController } from './controller'
import type { PrecipTypeOverlayInterpolationWindowData } from '../../forecast-data'

export const FIELD_OVERLAY_LAYER_ID = 'field-overlay-renderer-layer-id'

export const fieldOverlayAdapter: RenderAdapter = {
  id: 'field-overlay',
  layerId: FIELD_OVERLAY_LAYER_ID,
  install(map) {
    if (map.getLayer(FIELD_OVERLAY_LAYER_ID)) return
    map.addLayer(
      createCustomLayer(FIELD_OVERLAY_LAYER_ID, createFieldOverlayRuntime()),
      resolveForecastLayerBeforeId(map),
    )
  },
  uninstall(map) {
    if (!map.getLayer(FIELD_OVERLAY_LAYER_ID)) return
    map.removeLayer(FIELD_OVERLAY_LAYER_ID)
  },
  apply(map, data) {
    applyPrecipTypeOverlayInterpolationWindow(map, data.precipTypeOverlay)
  },
}

export function applyPrecipTypeOverlayInterpolationWindow(
  map: MapLibreMap,
  frame: PrecipTypeOverlayInterpolationWindowData | null
): void {
  const controller = getFieldOverlayController(map)
  if (!controller?.isAvailable()) return

  controller.applyFrame(frame)
}
