import type { LayerId } from '../forecast-catalog'
import type {
  ForecastModelId,
  ForecastModelOption,
  LayerModelAvailability,
  ModelLayerAvailabilityIndex,
} from './schema'

export function modelOptionsFromAvailabilityIndex(
  availabilityIndex: ModelLayerAvailabilityIndex | null
): ForecastModelOption[] {
  if (!availabilityIndex) return []

  return Object.entries(availabilityIndex.models).map(([id, model]) => ({
    id,
    label: model.label,
  }))
}

export function getLayerModelAvailability(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  layerId: LayerId | string | null,
  modelId: ForecastModelId | string | null
): LayerModelAvailability | null {
  if (!availabilityIndex || layerId == null || modelId == null) return null
  return availabilityIndex.layers[String(layerId)]?.models[String(modelId)] ?? null
}

export function isLayerAvailableForModel(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  layerId: LayerId | string | null,
  modelId: ForecastModelId | string | null
): boolean {
  return getLayerModelAvailability(availabilityIndex, layerId, modelId)?.state === 'available'
}

export function resolveCompatibleModelId(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  layerId: LayerId | string | null,
  preferredModelId: ForecastModelId
): ForecastModelId | null {
  if (!availabilityIndex || layerId == null) return preferredModelId
  if (isLayerAvailableForModel(availabilityIndex, layerId, preferredModelId)) {
    return preferredModelId
  }

  return Object.keys(availabilityIndex.models)
    .find((modelId) => isLayerAvailableForModel(availabilityIndex, layerId, modelId)) ?? null
}

export function hasAnyAvailableModelForLayer(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  layerId: LayerId | string | null
): boolean {
  return Object.keys(availabilityIndex?.models ?? {})
    .some((modelId) => isLayerAvailableForModel(availabilityIndex, layerId, modelId))
}
