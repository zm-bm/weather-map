import type { Map as MapLibreMap } from 'maplibre-gl'

import type { PressureInterpolationWindowData } from '@/forecast/data'
import type { RenderAdapter } from '../adapter'
import {
  createCustomLayer,
  resolveForecastLayerBeforeId,
} from '../layer'
import { getContourOverlayController } from './controller'
import { createContourOverlayRuntime } from './engine/runtime'

export const CONTOUR_OVERLAY_LAYER_ID = 'contour-overlay-renderer-layer-id'

export const contourOverlayAdapter: RenderAdapter = {
  id: 'contour-overlay',
  layerId: CONTOUR_OVERLAY_LAYER_ID,
  install(map) {
    if (map.getLayer(CONTOUR_OVERLAY_LAYER_ID)) return
    map.addLayer(
      createCustomLayer(CONTOUR_OVERLAY_LAYER_ID, createContourOverlayRuntime()),
      resolveForecastLayerBeforeId(map),
    )
  },
  uninstall(map) {
    if (!map.getLayer(CONTOUR_OVERLAY_LAYER_ID)) return
    map.removeLayer(CONTOUR_OVERLAY_LAYER_ID)
  },
  apply(map, data) {
    applyPressureContourInterpolationWindow(map, data.windows.pressure ?? null)
  },
}

export function applyPressureContourInterpolationWindow(
  map: MapLibreMap,
  frame: PressureInterpolationWindowData | null
): void {
  const controller = getContourOverlayController(map)
  if (!controller?.isAvailable()) return

  try {
    controller.applyFrame(frame)
  } catch (error) {
    console.warn('[contour-overlay] failed to apply pressure contours', error)
    controller.applyFrame(null)
  }
}
