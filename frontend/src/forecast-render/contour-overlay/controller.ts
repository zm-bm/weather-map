import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { PressureContourInterpolationWindowData } from '../../forecast-data'

export type ContourOverlayController = MapFrameController<PressureContourInterpolationWindowData | null>

const controllers = createMapControllerRegistry<ContourOverlayController>()

export function getContourOverlayController(map: MapLibreMap): ContourOverlayController | null {
  return controllers.get(map)
}

export function registerContourOverlayController(map: MapLibreMap, controller: ContourOverlayController) {
  controllers.register(map, controller)
}

export function unregisterContourOverlayController(map: MapLibreMap) {
  controllers.unregister(map)
}
