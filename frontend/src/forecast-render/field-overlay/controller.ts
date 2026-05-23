import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { PrecipTypeInterpolationWindowData } from '../../forecast-data'

export type FieldOverlayController = MapFrameController<PrecipTypeInterpolationWindowData | null>

const controllers = createMapControllerRegistry<FieldOverlayController>()

export function getFieldOverlayController(map: MapLibreMap): FieldOverlayController | null {
  return controllers.get(map)
}

export function registerFieldOverlayController(map: MapLibreMap, controller: FieldOverlayController) {
  controllers.register(map, controller)
}

export function unregisterFieldOverlayController(map: MapLibreMap) {
  controllers.unregister(map)
}
