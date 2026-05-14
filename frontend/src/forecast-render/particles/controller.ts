import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { ParticleFrameWindowData } from '../../forecast-frame'

export type ParticleController = MapFrameController<ParticleFrameWindowData>

const controllers = createMapControllerRegistry<ParticleController>()

export function getParticleController(map: MapLibreMap): ParticleController | null {
  return controllers.get(map)
}

export function registerParticleController(map: MapLibreMap, controller: ParticleController) {
  controllers.register(map, controller)
}

export function unregisterParticleController(map: MapLibreMap) {
  controllers.unregister(map)
}
