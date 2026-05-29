import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  applyNullableRenderFrame,
  createRenderLayerAdapter,
  createRenderControllerRegistry,
} from '../../maplibre/layerAdapter'
import { createOverlayRuntime } from './runtime'
import type { OverlayController } from './runtime'
import type { OverlayWindow } from '@/forecast/frames'

export const OVERLAY_LAYER_ID = 'forecast-overlay-layer'

const overlayControllerRegistry = createRenderControllerRegistry<OverlayController>()

export const overlayAdapter = createRenderLayerAdapter({
  id: 'overlay',
  layerId: OVERLAY_LAYER_ID,
  createRuntime: () => createOverlayRuntime(overlayControllerRegistry),
  apply: (map, windows) => applyOverlayWindow(map, windows.overlay ?? null),
})

function applyOverlayWindow(
  map: MapLibreMap,
  frame: OverlayWindow | null
): void {
  applyNullableRenderFrame({
    map,
    controllerRegistry: overlayControllerRegistry,
    frame,
    ignoreUnavailable: true,
  })
}
