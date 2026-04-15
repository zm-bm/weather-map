import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createControllerRegistry,
  type FrameRuntimeController,
} from '../shared'
import type { ScalarFrameData } from './engine/types'

export type ScalarController = FrameRuntimeController<ScalarFrameData>

const controllers = createControllerRegistry<ScalarController>()

export function getScalarController(map: MapLibreMap): ScalarController | null {
  return controllers.get(map)
}

export function registerScalarController(map: MapLibreMap, controller: ScalarController) {
  controllers.register(map, controller)
}

export function unregisterScalarController(map: MapLibreMap) {
  controllers.unregister(map)
}
