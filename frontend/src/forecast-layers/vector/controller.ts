import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { VectorFrameData } from './engine/types'

export type VectorController = MapFrameController<VectorFrameData>

const controllers = createMapControllerRegistry<VectorController>()

export function getVectorController(map: MapLibreMap): VectorController | null {
  return controllers.get(map)
}

export function registerVectorController(map: MapLibreMap, controller: VectorController) {
  controllers.register(map, controller)
}

export function unregisterVectorController(map: MapLibreMap) {
  controllers.unregister(map)
}
