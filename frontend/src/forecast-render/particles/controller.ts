import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { ParticleInterpolationWindowData } from '../../forecast-data'

export type ParticleController = MapFrameController<ParticleInterpolationWindowData>

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
