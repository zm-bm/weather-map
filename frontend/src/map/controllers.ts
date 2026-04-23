import type { Map as MapLibreMap } from 'maplibre-gl'

export type MapFrameController<TFrame> = {
  isAvailable: () => boolean
  applyFrame: (frame: TFrame) => void
  setEnabled: (enabled: boolean) => void
}

export type MapControllerRegistry<TController> = {
  get: (map: MapLibreMap) => TController | null
  register: (map: MapLibreMap, controller: TController) => void
  unregister: (map: MapLibreMap) => void
}

export function createMapControllerRegistry<TController>(): MapControllerRegistry<TController> {
  const controllers = new WeakMap<MapLibreMap, TController>()

  return {
    get(map) {
      return controllers.get(map) ?? null
    },
    register(map, controller) {
      controllers.set(map, controller)
    },
    unregister(map) {
      controllers.delete(map)
    },
  }
}
