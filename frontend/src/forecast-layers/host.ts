import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import type { ForecastFrames } from '../forecast-frame'
import type { ForecastLayer } from './types'
import { applyScalarFrame, scalarLayerAdapter } from './scalar'
import { applyVectorFrame, vectorLayerAdapter } from './vector'

export const forecastLayers: readonly ForecastLayer[] = [
  scalarLayerAdapter,
  vectorLayerAdapter,
] as const

export function installForecastLayers(map: MapLibreMap): void {
  for (const layer of forecastLayers) {
    layer.install(map)
  }
}

export function applyForecastFrames(map: MapLibreMap, frames: ForecastFrames): void {
  applyScalarFrame(map, frames.scalar)
  applyVectorFrame(map, frames.vector)
}
