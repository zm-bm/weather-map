import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { CloudLayersInterpolationWindowData } from '../../forecast-data'

export type CloudLayersController = MapFrameController<CloudLayersInterpolationWindowData | null>

const controllers = createMapControllerRegistry<CloudLayersController>()

export function getCloudLayersController(map: MapLibreMap): CloudLayersController | null {
  return controllers.get(map)
}

export function registerCloudLayersController(map: MapLibreMap, controller: CloudLayersController) {
  controllers.register(map, controller)
}

export function unregisterCloudLayersController(map: MapLibreMap) {
  controllers.unregister(map)
}
