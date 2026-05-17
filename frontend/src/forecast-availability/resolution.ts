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

export function availableModelIdsForLayer(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  layerId: LayerId | string | null
): ForecastModelId[] {
  if (!availabilityIndex || layerId == null) return []
  const layer = availabilityIndex.layers[String(layerId)]
  if (!layer) return []

  return Object.keys(availabilityIndex.models)
    .filter((modelId) => layer.models[modelId]?.state === 'available')
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

  return availableModelIdsForLayer(availabilityIndex, layerId)[0] ?? null
}

export function hasAnyAvailableModelForLayer(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  layerId: LayerId | string | null
): boolean {
  return availableModelIdsForLayer(availabilityIndex, layerId).length > 0
}

export function manifestPathForModel(
  availabilityIndex: ModelLayerAvailabilityIndex | null,
  modelId: ForecastModelId | string | null
): string | undefined {
  if (modelId == null) return undefined
  return availabilityIndex?.models[String(modelId)]?.latestManifestPath
}
