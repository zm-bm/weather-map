import { z } from 'zod'

export const DATA_MANIFEST_SCHEMA = 'weather-map.data-manifest'
export const DATA_MANIFEST_SCHEMA_VERSION = 1
export const DATA_PAYLOAD_CONTRACT = 'field-binary-v2'

const ARTIFACT_TEMPORAL_KINDS = ['instantaneous_rate', 'average_rate', 'accumulation'] as const

const finiteNumberSchema = z.number().finite()
const componentNameSchema = z.string().trim().min(1)
const optionalTemporalKindSchema = z.enum(ARTIFACT_TEMPORAL_KINDS).optional()
const optionalSourceIntervalHoursSchema = finiteNumberSchema.positive().optional()

const runSchema = z.object({
  cycle: z.string(),
  run_id: z.string().min(1),
  payload_root: z.string().min(1),
  generated_at: z.string(),
  revision: z.string(),
})

const frameSchema = z.object({
  id: z.string(),
  lead_hours: finiteNumberSchema,
  valid_at: z.string(),
})

const gridSchema = z.object({
  id: z.string(),
  crs: z.string(),
  nx: finiteNumberSchema,
  ny: finiteNumberSchema,
  lon0: finiteNumberSchema,
  lat0: finiteNumberSchema,
  dx: finiteNumberSchema,
  dy: finiteNumberSchema,
  origin: z.literal('cell_center'),
  layout: z.literal('row_major'),
  x_wrap: z.enum(['repeat', 'none']),
  y_mode: z.literal('clamp'),
})

const finiteValueRangeSchema = z.object({
  min: finiteNumberSchema,
  max: finiteNumberSchema,
})

const scalarLinearInt8EncodingSchema = z.object({
  id: z.string(),
  format: z.literal('linear-i8-v1'),
  dtype: z.literal('int8'),
  byte_order: z.literal('none'),
  nodata: finiteNumberSchema,
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decode_formula: z.string(),
  finite_value_range: finiteValueRangeSchema.optional(),
})

const scalarTempCPiecewiseEncodingSchema = z.object({
  id: z.string(),
  format: z.literal('temp-c-piecewise-i8-v1'),
  dtype: z.literal('int8'),
  byte_order: z.literal('none'),
  nodata: z.literal(-128),
})

const scalarEncodingSchema = z.discriminatedUnion('format', [
  scalarLinearInt8EncodingSchema,
  scalarTempCPiecewiseEncodingSchema,
])

const vectorEncodingSchema = z.object({
  id: z.string(),
  format: z.literal('linear-i8-v1'),
  dtype: z.literal('int8'),
  byte_order: z.literal('none'),
  nodata: finiteNumberSchema.optional(),
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decode_formula: z.string(),
  finite_value_range: finiteValueRangeSchema.optional(),
})

const layerAvailabilityStateSchema = z.enum([
  'available',
  'unsupported',
  'temporarily_unavailable',
])

const layerSupportSchema = z.enum([
  'native',
  'frontend-derived',
  'etl-derived',
  'unavailable',
])

const layerDatasetAvailabilitySchema = z.object({
  state: layerAvailabilityStateSchema,
  support: layerSupportSchema,
  required_artifacts: z.array(z.string()),
  optional_artifacts: z.array(z.string()).default([]),
})

const manifestArtifactCommonSchema = {
  id: z.string(),
  units: z.string(),
  parameter: z.string(),
  level: z.string(),
  components: z.array(componentNameSchema).nonempty(),
  grid: gridSchema,
  byte_length: finiteNumberSchema.positive(),
  payload_file: z.string().min(1),
  temporal_kind: optionalTemporalKindSchema,
  source_interval_hours: optionalSourceIntervalHoursSchema,
}

const scalarArtifactSchema = z.object({
  ...manifestArtifactCommonSchema,
  kind: z.literal('scalar'),
  encoding: scalarEncodingSchema,
})

const vectorArtifactSchema = z.object({
  ...manifestArtifactCommonSchema,
  kind: z.literal('vector'),
  encoding: vectorEncodingSchema,
})

const manifestArtifactSchema = z.discriminatedUnion('kind', [
  scalarArtifactSchema,
  vectorArtifactSchema,
])

const latestForecastRunSchema = z.object({
  run: runSchema,
  frames: z.array(frameSchema).nonempty('expected at least one frame'),
  artifacts: z.record(z.string(), manifestArtifactSchema),
})
  .superRefine((latest, ctx) => {
    const seenFrames = new Set<string>()
    for (const [frameIndex, frame] of latest.frames.entries()) {
      if (!seenFrames.has(frame.id)) {
        seenFrames.add(frame.id)
        continue
      }
      ctx.addIssue({
        code: 'custom',
        path: ['frames', frameIndex, 'id'],
        message: `duplicate frame id ${frame.id}`,
      })
    }

    const artifactEntries = Object.entries(latest.artifacts)
    if (artifactEntries.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'expected at least one artifact',
      })
    }

    for (const [artifactId, artifact] of artifactEntries) {
      if (artifact.id !== artifactId) {
        ctx.addIssue({
          code: 'custom',
          path: ['artifacts', artifactId, 'id'],
          message: `artifact key ${artifactId} does not match id ${artifact.id}`,
        })
      }
    }
  })

const manifestDatasetSchema = z.object({
  label: z.string(),
  latest: latestForecastRunSchema.nullable(),
})

const manifestLayerSchema = z.object({
  datasets: z.record(z.string(), layerDatasetAvailabilitySchema),
})

export const manifestSchema = z.object({
  schema: z.literal(DATA_MANIFEST_SCHEMA),
  schema_version: z.literal(DATA_MANIFEST_SCHEMA_VERSION),
  generated_at: z.string(),
  catalog_version: z.string(),
  payload_contract: z.literal(DATA_PAYLOAD_CONTRACT),
  datasets: z.record(z.string(), manifestDatasetSchema),
  layers: z.record(z.string(), manifestLayerSchema),
})

export function parseManifest(value: unknown): Manifest {
  return manifestSchema.parse(value)
}

export type ForecastRunSpec = z.infer<typeof runSchema>
export type ForecastFrameSpec = z.infer<typeof frameSchema>
export type GridSpec = z.infer<typeof gridSchema>
export type ScalarLinearInt8EncodingSpec = z.infer<typeof scalarLinearInt8EncodingSchema>
export type ScalarTempCPiecewiseEncodingSpec = z.infer<typeof scalarTempCPiecewiseEncodingSchema>
export type ScalarEncodingSpec = z.infer<typeof scalarEncodingSchema>
export type VectorEncodingSpec = z.infer<typeof vectorEncodingSchema>
export type ManifestEncodingSpec = ScalarEncodingSpec | VectorEncodingSpec
export type ArtifactKind = ManifestArtifactSpec['kind']
export type ScalarArtifactSpec = z.infer<typeof scalarArtifactSchema>
export type VectorArtifactSpec = z.infer<typeof vectorArtifactSchema>
export type ManifestArtifactSpec = z.infer<typeof manifestArtifactSchema>
export type LayerDatasetAvailability = z.infer<typeof layerDatasetAvailabilitySchema>
export type LatestForecastRun = z.infer<typeof latestForecastRunSchema>
export type Manifest = z.infer<typeof manifestSchema>
export type ForecastDatasetId = string
export type ActiveForecastRun = {
  manifest: Manifest
  datasetId: ForecastDatasetId
  label: string
  latest: LatestForecastRun
}
export type ForecastDatasetOption = {
  id: ForecastDatasetId
  label: string
}
