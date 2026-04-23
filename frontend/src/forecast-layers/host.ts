import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import {
  isSyncableForecastLayer,
  type ForecastLayer,
} from './types'
import { scalarLayerAdapter } from './scalar'
import { vectorLayerAdapter } from './vector'

export const forecastLayers: readonly ForecastLayer[] = [
  scalarLayerAdapter,
  vectorLayerAdapter,
] as const

export const syncableForecastLayers = forecastLayers.filter(isSyncableForecastLayer)

export function installForecastLayers(map: MapLibreMap): void {
  for (const layer of forecastLayers) {
    layer.install(map)
  }
}
