import { z } from 'zod'

export const layerAvailabilityStateSchema = z.enum([
  'available',
  'unsupported',
  'temporarily_unavailable',
])

export const layerSupportSchema = z.enum([
  'native',
  'frontend-derived',
  'etl-derived',
  'composite',
  'unavailable',
])

export const layerModelAvailabilitySchema = z.object({
  state: layerAvailabilityStateSchema,
  support: layerSupportSchema,
  requiredArtifacts: z.array(z.string()),
  optionalArtifacts: z.array(z.string()).default([]),
})

const availabilityModelSchema = z.object({
  label: z.string(),
  latestCycle: z.string().nullable(),
  latestManifestPath: z.string(),
})

const availabilityLayerSchema = z.object({
  models: z.record(z.string(), layerModelAvailabilitySchema),
})

export const modelLayerAvailabilityIndexSchema = z.object({
  schema: z.literal('weather-map-model-layer-availability-index'),
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  catalogVersion: z.string(),
  models: z.record(z.string(), availabilityModelSchema),
  layers: z.record(z.string(), availabilityLayerSchema),
})

export type LayerAvailabilityState = z.infer<typeof layerAvailabilityStateSchema>
export type LayerSupport = z.infer<typeof layerSupportSchema>
export type LayerModelAvailability = z.infer<typeof layerModelAvailabilitySchema>
export type ModelLayerAvailabilityIndex = z.infer<typeof modelLayerAvailabilityIndexSchema>
export type ForecastModelId = string
export type ForecastModelOption = {
  id: ForecastModelId
  label: string
}
