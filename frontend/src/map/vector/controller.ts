import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createControllerRegistry,
  type FrameRuntimeController,
} from '../shared'
import type { VectorFrameData } from './engine/types'

export type VectorController = FrameRuntimeController<VectorFrameData>

const controllers = createControllerRegistry<VectorController>()

export function getVectorController(map: MapLibreMap): VectorController | null {
  return controllers.get(map)
}

export function registerVectorController(map: MapLibreMap, controller: VectorController) {
  controllers.register(map, controller)
}

export function unregisterVectorController(map: MapLibreMap) {
  controllers.unregister(map)
}
