import type { Map as MapLibreMap } from 'maplibre-gl'

import type { RenderAdapter } from '../adapter'
import {
  createCustomLayer,
  resolveForecastLayerBeforeId,
} from '../layer'
import { createCloudLayersRuntime } from './runtime'
import { getCloudLayersController } from './controller'
import type { CloudLayersInterpolationWindowData } from '../../forecast-products'

export const CLOUD_LAYERS_LAYER_ID = 'cloud-layers-renderer-layer-id'

export const cloudLayersAdapter: RenderAdapter = {
  id: 'cloud-layers',
  layerId: CLOUD_LAYERS_LAYER_ID,
  install(map) {
    if (map.getLayer(CLOUD_LAYERS_LAYER_ID)) return
    map.addLayer(
      createCustomLayer(CLOUD_LAYERS_LAYER_ID, createCloudLayersRuntime()),
      resolveForecastLayerBeforeId(map),
    )
  },
  uninstall(map) {
    if (!map.getLayer(CLOUD_LAYERS_LAYER_ID)) return
    map.removeLayer(CLOUD_LAYERS_LAYER_ID)
  },
  apply(map, data) {
    applyCloudLayersInterpolationWindow(map, data.products.cloudLayers ?? null)
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
