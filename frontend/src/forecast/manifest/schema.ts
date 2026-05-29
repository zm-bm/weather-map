import { z } from 'zod'

export const FORECAST_MANIFEST_SCHEMA = 'weather-map.forecast-manifest'
export const FORECAST_MANIFEST_SCHEMA_VERSION = 1
export const FORECAST_PAYLOAD_CONTRACT = 'forecast-binary-v2'

const ARTIFACT_TEMPORAL_KINDS = ['instantaneous_rate', 'average_rate', 'accumulation'] as const

const finiteNumberSchema = z.number().finite()
const componentNameSchema = z.string().trim().min(1)
const optionalTemporalKindSchema = z.enum(ARTIFACT_TEMPORAL_KINDS).optional()
const optionalSourceIntervalHoursSchema = finiteNumberSchema.positive().optional()

const runSchema = z.object({
  cycle: z.string(),
  generatedAt: z.string(),
  revision: z.string(),
})

const timeSchema = z.object({
  id: z.string(),
  leadHours: finiteNumberSchema,
  validAt: z.string(),
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
  xWrap: z.enum(['repeat', 'none']),
  yMode: z.literal('clamp'),
})

const finiteValueRangeSchema = z.object({
  min: finiteNumberSchema,
  max: finiteNumberSchema,
})

const scalarLinearInt8EncodingSchema = z.object({
  id: z.string(),
  format: z.literal('linear-i8-v1'),
  dtype: z.literal('int8'),
  byteOrder: z.literal('none'),
  nodata: finiteNumberSchema,
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decodeFormula: z.string(),
  finiteValueRange: finiteValueRangeSchema.optional(),
})

const scalarTempCPiecewiseEncodingSchema = z.object({
  id: z.string(),
  format: z.literal('temp-c-piecewise-i8-v1'),
  dtype: z.literal('int8'),
  byteOrder: z.literal('none'),
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
  byteOrder: z.literal('none'),
  nodata: finiteNumberSchema.optional(),
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decodeFormula: z.string(),
  finiteValueRange: finiteValueRangeSchema.optional(),
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

const layerModelAvailabilitySchema = z.object({
  state: layerAvailabilityStateSchema,
  support: layerSupportSchema,
  requiredArtifacts: z.array(z.string()),
  optionalArtifacts: z.array(z.string()).default([]),
})

const manifestArtifactCommonSchema = {
  id: z.string(),
  units: z.string(),
  parameter: z.string(),
  level: z.string(),
  components: z.array(componentNameSchema).nonempty(),
  grid: gridSchema,
  byteLength: finiteNumberSchema.positive(),
  temporalKind: optionalTemporalKindSchema,
  sourceIntervalHours: optionalSourceIntervalHoursSchema,
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
  times: z.array(timeSchema).nonempty('expected at least one time'),
  artifacts: z.record(z.string(), manifestArtifactSchema),
})
  .superRefine((latest, ctx) => {
    const seenTimes = new Set<string>()
    for (const [timeIndex, time] of latest.times.entries()) {
      if (!seenTimes.has(time.id)) {
        seenTimes.add(time.id)
        continue
      }
      ctx.addIssue({
        code: 'custom',
        path: ['times', timeIndex, 'id'],
        message: `duplicate time id ${time.id}`,
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

const manifestModelSchema = z.object({
  label: z.string(),
  latest: latestForecastRunSchema.nullable(),
})

const manifestLayerSchema = z.object({
  models: z.record(z.string(), layerModelAvailabilitySchema),
})

export const manifestSchema = z.object({
  schema: z.literal(FORECAST_MANIFEST_SCHEMA),
  schemaVersion: z.literal(FORECAST_MANIFEST_SCHEMA_VERSION),
  generatedAt: z.string(),
  catalogVersion: z.string(),
  payloadContract: z.literal(FORECAST_PAYLOAD_CONTRACT),
  models: z.record(z.string(), manifestModelSchema),
  layers: z.record(z.string(), manifestLayerSchema),
})

export function parseManifest(value: unknown): Manifest {
  return manifestSchema.parse(value)
}

export type ForecastRunSpec = z.infer<typeof runSchema>
export type ForecastTimeSpec = z.infer<typeof timeSchema>
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
export type LayerModelAvailability = z.infer<typeof layerModelAvailabilitySchema>
export type LatestForecastRun = z.infer<typeof latestForecastRunSchema>
export type Manifest = z.infer<typeof manifestSchema>
export type ForecastModelId = string
export type ActiveForecastRun = {
  manifest: Manifest
  modelId: ForecastModelId
  label: string
  latest: LatestForecastRun
}
export type ForecastModelOption = {
  id: ForecastModelId
  label: string
}
