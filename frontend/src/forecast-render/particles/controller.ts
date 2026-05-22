import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { ParticleInterpolationWindowData } from '../../forecast-data'
import type { ParticleRenderSettings } from '../../forecast-settings/settings'

export type ParticleController = MapFrameController<ParticleInterpolationWindowData> & {
  applySettings: (settings: Partial<ParticleRenderSettings>) => void
}

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
