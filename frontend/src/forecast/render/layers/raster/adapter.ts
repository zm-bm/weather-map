import type { Map as MapLibreMap } from 'maplibre-gl'

import type { RasterWindow } from '@/forecast/frames'
import type { RasterRenderSettings } from '@/forecast/settings/settings'
import {
  applyNullableRenderFrame,
  createRenderControllerRegistry,
  createRenderLayerAdapter,
} from '../../maplibre/layerAdapter'
import {
  createRasterRuntime,
  type RasterController,
} from './runtime'

export const RASTER_LAYER_ID = 'forecast-raster-layer'

const rasterControllerRegistry = createRenderControllerRegistry<RasterController>()

export const rasterAdapter = createRenderLayerAdapter({
  id: 'raster',
  layerId: RASTER_LAYER_ID,
  createRuntime: (renderSettings) => createRasterRuntime(
    rasterControllerRegistry,
    renderSettings.raster
  ),
  configure: (map, renderSettings) => applyRasterRenderSettings(map, renderSettings.raster),
  apply: (map, windows) => applyRasterWindow(map, windows.raster ?? null),
})

function applyRasterWindow(map: MapLibreMap, frame: RasterWindow | null): void {
  applyNullableRenderFrame({
    map,
    controllerRegistry: rasterControllerRegistry,
    frame,
    unavailableMessage: 'Raster renderer unavailable (WebGL2 required)',
  })
}

function applyRasterRenderSettings(
  map: MapLibreMap,
  settings: RasterRenderSettings,
): void {
  const controller = rasterControllerRegistry.get(map)
  controller?.applySettings(settings)
}
