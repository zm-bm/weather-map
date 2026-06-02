import { loadLocalStorageString, saveLocalStorageString } from '@/core/storage/localStorage'
import {
  activeForecastRunForDataset,
  type ForecastDatasetId,
  type Manifest,
} from '@/forecast/manifest'

export const ACTIVE_DATASET_STORAGE_KEY = 'weather-map:active-dataset-id'

export function loadStoredActiveDatasetId(): ForecastDatasetId | null {
  return loadLocalStorageString(ACTIVE_DATASET_STORAGE_KEY)
}

export function saveStoredActiveDatasetId(datasetId: ForecastDatasetId): void {
  saveLocalStorageString(ACTIVE_DATASET_STORAGE_KEY, datasetId)
}

export function normalizeActiveDatasetId(
  manifest: Manifest | null,
  datasetId: ForecastDatasetId | null | undefined
): ForecastDatasetId | null {
  if (datasetId == null) return null
  return activeForecastRunForDataset(manifest, datasetId) ? datasetId : null
}
