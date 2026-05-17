import { modelLayerAvailabilityIndexSchema, type ModelLayerAvailabilityIndex } from './schema'

export function parseAvailabilityIndex(value: unknown): ModelLayerAvailabilityIndex {
  return modelLayerAvailabilityIndexSchema.parse(value)
}
