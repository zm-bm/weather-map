import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createMapControllerRegistry,
  type MapFrameController,
} from '../../map/controllers'
import type { FieldInterpolationWindowData } from '../../forecast-data'
import type { FieldRenderSettings } from '../../forecast-settings/settings'

export type FieldController = MapFrameController<FieldInterpolationWindowData | null> & {
  applySettings: (settings: FieldRenderSettings) => void
}

const controllers = createMapControllerRegistry<FieldController>()

export function getFieldController(map: MapLibreMap): FieldController | null {
  return controllers.get(map)
}

export function registerFieldController(map: MapLibreMap, controller: FieldController) {
  controllers.register(map, controller)
}

export function unregisterFieldController(map: MapLibreMap) {
  controllers.unregister(map)
}
