import type { Map as MapLibreMap } from 'maplibre-gl'

import type { WeatherMapConfig } from '../config'
import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../manifest'

export const FORECAST_LAYER_BEFORE_ID = 'background' as const

export type ForecastLayerSyncArgs = {
  map: MapLibreMap
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  signal: AbortSignal
}

export type ForecastLayer = {
  layerId: string
  install: (map: MapLibreMap) => void
  applySync?: (args: ForecastLayerSyncArgs) => Promise<void>
}

export function isSyncableForecastLayer(
  layer: ForecastLayer
): layer is ForecastLayer & { applySync: NonNullable<ForecastLayer['applySync']> } {
  return typeof layer.applySync === 'function'
}
