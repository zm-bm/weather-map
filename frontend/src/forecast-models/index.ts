export type ForecastModelId = 'gfs' | 'icon'

export type ForecastModelOption = {
  id: ForecastModelId
  label: string
}

export const FORECAST_MODEL_OPTIONS: readonly ForecastModelOption[] = [
  { id: 'gfs', label: 'GFS' },
  { id: 'icon', label: 'ICON' },
]

export const DEFAULT_FORECAST_MODEL_ID: ForecastModelId = 'gfs'

export function getForecastModelLabel(modelId: ForecastModelId): string {
  return FORECAST_MODEL_OPTIONS.find((model) => model.id === modelId)?.label ?? modelId.toUpperCase()
}
