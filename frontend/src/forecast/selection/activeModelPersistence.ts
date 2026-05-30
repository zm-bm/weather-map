import { loadLocalStorageString, saveLocalStorageString } from '@/core/storage/localStorage'
import {
  activeForecastRunForModel,
  type ForecastModelId,
  type Manifest,
} from '@/forecast/manifest'

export const ACTIVE_MODEL_STORAGE_KEY = 'weather-map:active-model-id'

export function loadStoredActiveModelId(): ForecastModelId | null {
  return loadLocalStorageString(ACTIVE_MODEL_STORAGE_KEY)
}

export function saveStoredActiveModelId(modelId: ForecastModelId): void {
  saveLocalStorageString(ACTIVE_MODEL_STORAGE_KEY, modelId)
}

export function normalizeActiveModelId(
  manifest: Manifest | null,
  modelId: ForecastModelId | null | undefined
): ForecastModelId | null {
  if (modelId == null) return null
  return activeForecastRunForModel(manifest, modelId) ? modelId : null
}
