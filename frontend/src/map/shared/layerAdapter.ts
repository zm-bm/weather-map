import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl'

import type { WeatherMapConfig } from '../../config'
import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../../manifest'

export type LayerSyncArgs = {
  map: MapLibreMap
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  signal: AbortSignal
}

export type LayerAdapter = {
  layerId: string
  createLayer: () => CustomLayerInterface
  applySync: (args: LayerSyncArgs) => Promise<void>
}
