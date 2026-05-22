import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderer } from '../types'
import { resolveForecastLayerBeforeId } from '../placement'
import { createFieldRuntime } from './engine/runtime'
import { getFieldController } from './controller'
import type { FieldInterpolationWindowData } from '../../forecast-data'
import type {
  FieldRenderSettings,
  ForecastRenderSettings,
} from '../../forecast-settings/settings'

export const FIELD_RENDERER_LAYER_ID = 'field-renderer-layer-id'

export const fieldRenderer: ForecastRenderer = {
  id: 'field',
  layerId: FIELD_RENDERER_LAYER_ID,
  install(map, renderSettings) {
    if (map.getLayer(FIELD_RENDERER_LAYER_ID)) return
    map.addLayer(createFieldCustomLayer(renderSettings.field), resolveForecastLayerBeforeId(map))
  },
  uninstall(map) {
    if (!map.getLayer(FIELD_RENDERER_LAYER_ID)) return
    map.removeLayer(FIELD_RENDERER_LAYER_ID)
  },
  configure(map, renderSettings) {
    applyFieldRenderSettings(map, renderSettings.field)
  },
  apply(map, data) {
    applyFieldInterpolationWindow(map, data.field)
  },
}

export function applyFieldInterpolationWindow(map: MapLibreMap, frame: FieldInterpolationWindowData | null): void {
  const controller = getFieldController(map)
  if (!controller?.isAvailable()) {
    if (frame == null) return
    throw new Error('Field renderer unavailable (WebGL2 required)')
  }

  controller.applyFrame(frame)
}

export function applyFieldRenderSettings(
  map: MapLibreMap,
  settings: FieldRenderSettings,
): void {
  const controller = getFieldController(map)
  controller?.applySettings(settings)
}

function createFieldCustomLayer(settings: ForecastRenderSettings['field']) {
  const runtime = createFieldRuntime(settings)
  return {
    id: FIELD_RENDERER_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
