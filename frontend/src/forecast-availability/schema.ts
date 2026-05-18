import { z } from 'zod'

import {
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
} from '../manifest/constants'
import {
  gridSchema,
  runSchema,
  scalarEncodingSchema,
  timeSchema,
  vectorEncodingSchema,
} from '../manifest/schema'

const layerAvailabilityStateSchema = z.enum([
  'available',
  'unsupported',
  'temporarily_unavailable',
])

const layerSupportSchema = z.enum([
  'native',
  'frontend-derived',
  'etl-derived',
  'composite',
  'unavailable',
])

const layerModelAvailabilitySchema = z.object({
  state: layerAvailabilityStateSchema,
  support: layerSupportSchema,
  requiredArtifacts: z.array(z.string()),
  optionalArtifacts: z.array(z.string()).default([]),
})

const finiteNumberSchema = z.number().finite()
const componentNameSchema = z.string().trim().min(1)

const availabilityArtifactCommonSchema = {
  id: z.string(),
  units: z.string(),
  parameter: z.string(),
  level: z.string(),
  components: z.array(componentNameSchema).nonempty(),
  grid: gridSchema,
  byteLength: finiteNumberSchema.positive(),
  temporalKind: z.enum(['instantaneous_rate', 'average_rate', 'accumulation']).optional(),
  sourceIntervalHours: finiteNumberSchema.positive().optional(),
}

const availabilityScalarArtifactSchema = z.object({
  ...availabilityArtifactCommonSchema,
  kind: z.literal('scalar'),
  encoding: scalarEncodingSchema,
})

const availabilityVectorArtifactSchema = z.object({
  ...availabilityArtifactCommonSchema,
  kind: z.literal('vector'),
  encoding: vectorEncodingSchema,
})

const availabilityManifestArtifactSchema = z.discriminatedUnion('kind', [
  availabilityScalarArtifactSchema,
  availabilityVectorArtifactSchema,
])

const availabilityLatestManifestSchema = z.object({
  schema: z.literal(MANIFEST_SCHEMA),
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  payloadContract: z.literal(MANIFEST_PAYLOAD_CONTRACT),
  run: runSchema,
  times: z.array(timeSchema).nonempty('expected at least one time'),
  artifacts: z.record(z.string(), availabilityManifestArtifactSchema),
})

const availabilityModelSchema = z.object({
  label: z.string(),
  latest: availabilityLatestManifestSchema.nullable(),
})

const availabilityLayerSchema = z.object({
  models: z.record(z.string(), layerModelAvailabilitySchema),
})

export const modelLayerAvailabilityIndexSchema = z.object({
  schema: z.literal('weather-map-model-layer-availability-index'),
  schemaVersion: z.literal(2),
  generatedAt: z.string(),
  catalogVersion: z.string(),
  models: z.record(z.string(), availabilityModelSchema),
  layers: z.record(z.string(), availabilityLayerSchema),
})

export type LayerAvailabilityState = z.infer<typeof layerAvailabilityStateSchema>
export type LayerSupport = z.infer<typeof layerSupportSchema>
export type LayerModelAvailability = z.infer<typeof layerModelAvailabilitySchema>
export type AvailabilityScalarArtifactSpec = z.infer<typeof availabilityScalarArtifactSchema>
export type AvailabilityVectorArtifactSpec = z.infer<typeof availabilityVectorArtifactSchema>
export type AvailabilityManifestArtifactSpec = z.infer<typeof availabilityManifestArtifactSchema>
export type AvailabilityLatestManifest = z.infer<typeof availabilityLatestManifestSchema>
export type ModelLayerAvailabilityIndex = z.infer<typeof modelLayerAvailabilityIndexSchema>
export type ForecastModelId = string
export type ForecastModelOption = {
  id: ForecastModelId
  label: string
}
