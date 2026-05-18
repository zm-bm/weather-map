import type {
  ActiveForecastRun,
  ForecastModelId,
  ForecastModelOption,
} from './schema'

export type ForecastManifestData = {
  activeRun: ActiveForecastRun
  modelOptions: readonly ForecastModelOption[]
  setActiveModel: (modelId: ForecastModelId) => void
}

export type ForecastManifestState = {
  phase: 'loading' | 'ready' | 'error'
  data: ForecastManifestData | null
  error: Error | null
  retry: () => void
}
