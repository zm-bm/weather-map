import type {
  ForecastModelId,
  ForecastModelOption,
  ModelLayerAvailabilityIndex,
} from '../forecast-availability'
import type { CycleManifest } from '../manifest'

export type ForecastBootstrapData = {
  manifest: CycleManifest
  availabilityIndex: ModelLayerAvailabilityIndex
  activeModelId: ForecastModelId
  modelOptions: readonly ForecastModelOption[]
  setActiveModel: (modelId: ForecastModelId) => void
}

export type ForecastBootstrapState = {
  phase: 'loading' | 'ready' | 'error'
  data: ForecastBootstrapData | null
  error: Error | null
  retry: () => void
}
