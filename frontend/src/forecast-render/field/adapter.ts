import type { Map as MapLibreMap } from 'maplibre-gl'

import type { RenderAdapter } from '../adapter'
import {
  createCustomLayer,
  resolveForecastLayerBeforeId,
} from '../layer'
import { createFieldRuntime } from './engine/runtime'
import { getFieldController } from './controller'
import type { FieldInterpolationWindowData } from '../../forecast-data'
import type {
  FieldRenderSettings,
} from '../../forecast-settings/settings'

export const FIELD_LAYER_ID = 'field-renderer-layer-id'

export const fieldAdapter: RenderAdapter = {
  id: 'field',
  layerId: FIELD_LAYER_ID,
  install(map, renderSettings) {
    if (map.getLayer(FIELD_LAYER_ID)) return
    map.addLayer(
      createCustomLayer(FIELD_LAYER_ID, createFieldRuntime(renderSettings.field)),
      resolveForecastLayerBeforeId(map),
    )
  },
  uninstall(map) {
    if (!map.getLayer(FIELD_LAYER_ID)) return
    map.removeLayer(FIELD_LAYER_ID)
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
