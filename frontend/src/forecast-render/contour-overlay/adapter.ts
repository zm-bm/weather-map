import type { Map as MapLibreMap } from 'maplibre-gl'

import type { PressureContourInterpolationWindowData } from '../../forecast-data'
import type { ForecastRenderer } from '../types'
import { resolveForecastLayerBeforeId } from '../placement'
import { getContourOverlayController } from './controller'
import { createContourOverlayRuntime } from './engine/runtime'

export const CONTOUR_OVERLAY_RENDERER_LAYER_ID = 'contour-overlay-renderer-layer-id'

export const contourOverlayRenderer: ForecastRenderer = {
  id: 'contour-overlay',
  layerId: CONTOUR_OVERLAY_RENDERER_LAYER_ID,
  install(map) {
    if (map.getLayer(CONTOUR_OVERLAY_RENDERER_LAYER_ID)) return
    map.addLayer(createContourOverlayCustomLayer(), resolveForecastLayerBeforeId(map))
  },
  uninstall(map) {
    if (!map.getLayer(CONTOUR_OVERLAY_RENDERER_LAYER_ID)) return
    map.removeLayer(CONTOUR_OVERLAY_RENDERER_LAYER_ID)
  },
  apply(map, data) {
    applyPressureContourInterpolationWindow(map, data.pressureContours)
  },
}

export function applyPressureContourInterpolationWindow(
  map: MapLibreMap,
  frame: PressureContourInterpolationWindowData | null
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

function createContourOverlayCustomLayer() {
  const runtime = createContourOverlayRuntime()
  return {
    id: CONTOUR_OVERLAY_RENDERER_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
