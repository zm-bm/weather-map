import type { Map as MapLibreMap } from 'maplibre-gl'

import { FORECAST_LAYER_BEFORE_ID, type ForecastRenderer } from '../types'
import { createFieldRuntime } from './engine/runtime'
import { getFieldController } from './controller'
import { fieldRuntimeOptions } from './options'
import type { FieldInterpolationWindowData } from '../../forecast-data'

export const FIELD_RENDERER_LAYER_ID = 'field-renderer-layer-id'

export const fieldRenderer: ForecastRenderer = {
  layerId: FIELD_RENDERER_LAYER_ID,
  install(map) {
    if (map.getLayer(FIELD_RENDERER_LAYER_ID)) return
    map.addLayer(createFieldCustomLayer(), FORECAST_LAYER_BEFORE_ID)
  },
}

export function applyFieldInterpolationWindow(map: MapLibreMap, frame: FieldInterpolationWindowData): void {
  const controller = getFieldController(map)
  if (!controller?.isAvailable()) {
    throw new Error('Field renderer unavailable (WebGL2 required)')
  }

  controller.applyFrame(frame)
}

function createFieldCustomLayer() {
  const runtime = createFieldRuntime(fieldRuntimeOptions)
  return {
    id: FIELD_RENDERER_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
