import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import { FORECAST_OVERLAY_ANCHOR_LAYER_ID } from '@/map/basemap'

export type CustomLayerRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput
  ) => void
  onRemove: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createCustomLayer(id: string, runtime: CustomLayerRuntime) {
  return {
    id,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => runtime.onAdd(map, gl),
    render: (gl: WebGLRenderingContext | WebGL2RenderingContext, input: CustomRenderMethodInput) => runtime.render(gl, input),
    onRemove: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => runtime.onRemove(map, gl),
  }
}

export const FORECAST_LAYER_BEFORE_ID = FORECAST_OVERLAY_ANCHOR_LAYER_ID

export function resolveForecastLayerBeforeId(map: MapLibreMap): string | undefined {
  return map.getLayer(FORECAST_LAYER_BEFORE_ID) ? FORECAST_LAYER_BEFORE_ID : undefined
}
