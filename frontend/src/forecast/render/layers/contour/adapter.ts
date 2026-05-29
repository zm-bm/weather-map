import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ContourWindow } from '@/forecast/frames'
import {
  applyNullableRenderFrame,
  createRenderLayerAdapter,
  createRenderControllerRegistry,
} from '../../maplibre/layerAdapter'
import {
  createContourRuntime,
  type ContourController,
} from './runtime'

export const CONTOUR_LAYER_ID = 'forecast-contour-layer'

const contourControllerRegistry = createRenderControllerRegistry<ContourController>()

export const contourAdapter = createRenderLayerAdapter({
  id: 'contour',
  layerId: CONTOUR_LAYER_ID,
  createRuntime: () => createContourRuntime(contourControllerRegistry),
  apply: (map, windows) => applyContourWindow(map, windows.contour ?? null),
})

function applyContourWindow(
  map: MapLibreMap,
  frame: ContourWindow | null
): void {
  applyNullableRenderFrame({
    map,
    controllerRegistry: contourControllerRegistry,
    frame,
    ignoreUnavailable: true,
    onApplyError: (controller, error) => {
      console.warn('[contour] failed to apply pressure contours', error)
      controller.applyFrame(null)
    },
  })
}
