import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderer } from '../types'
import { resolveForecastLayerBeforeId } from '../placement'
import { createCloudLayersRuntime } from './runtime'
import { getCloudLayersController } from './controller'
import type { CloudLayersInterpolationWindowData } from '../../forecast-data'

export const CLOUD_LAYERS_RENDERER_LAYER_ID = 'cloud-layers-renderer-layer-id'

export const cloudLayersRenderer: ForecastRenderer = {
  id: 'cloud-layers',
  layerId: CLOUD_LAYERS_RENDERER_LAYER_ID,
  install(map) {
    if (map.getLayer(CLOUD_LAYERS_RENDERER_LAYER_ID)) return
    map.addLayer(createCloudLayersCustomLayer(), resolveForecastLayerBeforeId(map))
  },
  uninstall(map) {
    if (!map.getLayer(CLOUD_LAYERS_RENDERER_LAYER_ID)) return
    map.removeLayer(CLOUD_LAYERS_RENDERER_LAYER_ID)
  },
  apply(map, data) {
    applyCloudLayersInterpolationWindow(map, data.cloudLayers)
  },
}

export function applyCloudLayersInterpolationWindow(
  map: MapLibreMap,
  frame: CloudLayersInterpolationWindowData | null
): void {
  const controller = getCloudLayersController(map)
  if (!controller?.isAvailable()) {
    if (frame == null) return
    throw new Error('Cloud Layers renderer unavailable (WebGL2 required)')
  }

  controller.applyFrame(frame)
}

function createCloudLayersCustomLayer() {
  const runtime = createCloudLayersRuntime()
  return {
    id: CLOUD_LAYERS_RENDERER_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
