import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderer } from '../types'
import { resolveForecastLayerBeforeId } from '../placement'
import { createFieldOverlayRuntime } from './engine/runtime'
import { getFieldOverlayController } from './controller'
import type { PrecipTypeOverlayInterpolationWindowData } from '../../forecast-data'

export const FIELD_OVERLAY_RENDERER_LAYER_ID = 'field-overlay-renderer-layer-id'

export const fieldOverlayRenderer: ForecastRenderer = {
  id: 'field-overlay',
  layerId: FIELD_OVERLAY_RENDERER_LAYER_ID,
  install(map) {
    if (map.getLayer(FIELD_OVERLAY_RENDERER_LAYER_ID)) return
    map.addLayer(createFieldOverlayCustomLayer(), resolveForecastLayerBeforeId(map))
  },
  uninstall(map) {
    if (!map.getLayer(FIELD_OVERLAY_RENDERER_LAYER_ID)) return
    map.removeLayer(FIELD_OVERLAY_RENDERER_LAYER_ID)
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

function createFieldOverlayCustomLayer() {
  const runtime = createFieldOverlayRuntime()
  return {
    id: FIELD_OVERLAY_RENDERER_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
