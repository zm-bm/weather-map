import {
  loadLocalStorageString,
  saveLocalStorageString,
} from '@/core/storage/localStorage'
import { FORECAST_RASTER_LAYERS_BY_ID } from '@/forecast/catalog'

export const SELECTED_LAYER_QUERY_PARAM = 'layer'
export const SELECTED_LAYER_STORAGE_KEY = 'weather-map:selected-layer-id'
export const DEFAULT_SELECTED_LAYER_ID = 'temperature'

export function selectedLayerIdFromSearchParams(searchParams: URLSearchParams): string | null {
  return normalizeSelectedLayerId(searchParams.get(SELECTED_LAYER_QUERY_PARAM))
}

export function resolvePersistedSelectedLayerId(searchParams: URLSearchParams): string {
  return selectedLayerIdFromSearchParams(searchParams)
    ?? loadStoredSelectedLayerId()
    ?? DEFAULT_SELECTED_LAYER_ID
}

export function loadStoredSelectedLayerId(): string | null {
  return normalizeSelectedLayerId(loadLocalStorageString(SELECTED_LAYER_STORAGE_KEY))
}

export function saveStoredSelectedLayerId(layerId: string): void {
  if (!isValidSelectedLayerId(layerId)) return
  saveLocalStorageString(SELECTED_LAYER_STORAGE_KEY, layerId)
}

export function normalizeSelectedLayerId(layerId: string | null | undefined): string | null {
  if (layerId == null) return null
  return isValidSelectedLayerId(layerId) ? layerId : null
}

function isValidSelectedLayerId(layerId: string): boolean {
  return Object.prototype.hasOwnProperty.call(FORECAST_RASTER_LAYERS_BY_ID, layerId)
}
