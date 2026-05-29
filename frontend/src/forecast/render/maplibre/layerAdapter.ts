import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastWindows } from '@/forecast/frames'
import type { ForecastRenderSettings } from '@/forecast/settings/settings'
import {
  createMapControllerRegistry,
  type MapControllerRegistry,
  type MapFrameController,
} from '@/map/controllers'
import {
  createCustomLayer,
  resolveForecastLayerBeforeId,
  type CustomLayerRuntime,
} from './customLayer'
import type { ForecastRenderLayerId } from '../profile'

export type RenderLayerAdapter = {
  id: ForecastRenderLayerId
  layerId: string
  install: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  uninstall: (map: MapLibreMap) => void
  configure?: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  apply: (map: MapLibreMap, windows: ForecastWindows) => void
}

export type RenderControllerLifecycle<TController> = Pick<
  MapControllerRegistry<TController>,
  'register' | 'unregister'
>

export function createRenderControllerRegistry<TController>(): MapControllerRegistry<TController> {
  return createMapControllerRegistry<TController>()
}

export function createRenderLayerAdapter(args: {
  id: ForecastRenderLayerId
  layerId: string
  createRuntime: (renderSettings: ForecastRenderSettings) => CustomLayerRuntime
  configure?: (map: MapLibreMap, renderSettings: ForecastRenderSettings) => void
  apply: (map: MapLibreMap, windows: ForecastWindows) => void
}): RenderLayerAdapter {
  return {
    id: args.id,
    layerId: args.layerId,
    install(map, renderSettings) {
      if (map.getLayer(args.layerId)) return
      map.addLayer(
        createCustomLayer(args.layerId, args.createRuntime(renderSettings)),
        resolveForecastLayerBeforeId(map),
      )
    },
    uninstall(map) {
      if (!map.getLayer(args.layerId)) return
      map.removeLayer(args.layerId)
    },
    configure: args.configure,
    apply: args.apply,
  }
}

export function applyNullableRenderFrame<TFrame, TController extends MapFrameController<TFrame | null>>(args: {
  map: MapLibreMap
  controllerRegistry: Pick<MapControllerRegistry<TController>, 'get'>
  frame: TFrame | null
  unavailableMessage?: string
  ignoreUnavailable?: boolean
  onApplyError?: (controller: TController, error: unknown) => void
}): void {
  const controller = args.controllerRegistry.get(args.map)
  if (!controller?.isAvailable()) {
    if (args.frame == null || args.ignoreUnavailable) return
    throw new Error(args.unavailableMessage ?? 'Forecast render layer unavailable')
  }

  try {
    controller.applyFrame(args.frame)
  } catch (error) {
    if (!args.onApplyError) throw error
    args.onApplyError(controller, error)
  }
}
