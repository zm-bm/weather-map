import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { ScalarFrameData } from './engine/types'

export type ScalarController = MapFrameController<ScalarFrameData>

const controllers = createMapControllerRegistry<ScalarController>()

export function getScalarController(map: MapLibreMap): ScalarController | null {
  return controllers.get(map)
}

export function registerScalarController(map: MapLibreMap, controller: ScalarController) {
  controllers.register(map, controller)
}

export function unregisterScalarController(map: MapLibreMap) {
  controllers.unregister(map)
}
