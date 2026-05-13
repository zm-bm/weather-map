import { z } from 'zod'

import {
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
} from './constants'
import {
  asProductId,
  type NonEmptyArray,
  type ProductId,
} from './ids'

export type LayerColortableStop = [number, number, number, number] | [number, number, number]

const PRODUCT_TEMPORAL_KINDS = ['instantaneous_rate', 'average_rate', 'accumulation'] as const

const finiteNumberSchema = z.number().finite()
const componentNameSchema = z.string().trim().min(1)
const optionalTemporalKindSchema = z.enum(PRODUCT_TEMPORAL_KINDS).optional()
const optionalSourceIntervalHoursSchema = finiteNumberSchema.positive().optional()

export const modelSchema = z.object({
  id: z.string(),
  label: z.string(),
})

export const runSchema = z.object({
  cycle: z.string(),
  generatedAt: z.string(),
  revision: z.string(),
})

export const timeSchema = z.object({
  id: z.string(),
  leadHours: finiteNumberSchema,
  validAt: z.string(),
})

export const gridSchema = z.object({
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

export const scalarLinearInt16EncodingSchema = z.object({
  id: z.string(),
  format: z.literal('linear-i16-v1'),
  dtype: z.literal('int16'),
  byteOrder: z.enum(['little', 'big']),
  nodata: finiteNumberSchema,
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decodeFormula: z.string(),
})

export const scalarLinearInt8EncodingSchema = z.object({
  id: z.string(),
  format: z.literal('linear-i8-v1'),
  dtype: z.literal('int8'),
  byteOrder: z.literal('none'),
  nodata: finiteNumberSchema,
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decodeFormula: z.string(),
})

export const scalarTempCPiecewiseEncodingSchema = z.object({
  id: z.string(),
  format: z.literal('temp-c-piecewise-i8-v1'),
  dtype: z.literal('int8'),
  byteOrder: z.literal('none'),
  nodata: z.literal(-128),
})

export const scalarEncodingSchema = z.discriminatedUnion('format', [
  scalarLinearInt16EncodingSchema,
  scalarLinearInt8EncodingSchema,
  scalarTempCPiecewiseEncodingSchema,
])

export const vectorEncodingSchema = z.object({
  id: z.string(),
  format: z.literal('linear-i8-v1'),
  dtype: z.literal('int8'),
  byteOrder: z.literal('none'),
  scale: finiteNumberSchema,
  offset: finiteNumberSchema,
  decodeFormula: z.string(),
})

export const frameRefSchema = z.object({
  path: z.string(),
  byteLength: finiteNumberSchema,
  sha256: z.string(),
})

const productCommonSchema = {
  id: z.string(),
  units: z.string(),
  parameter: z.string(),
  level: z.string(),
  components: z.array(componentNameSchema).nonempty(),
  grid: gridSchema,
  frames: z.record(z.string(), frameRefSchema),
  temporalKind: optionalTemporalKindSchema,
  sourceIntervalHours: optionalSourceIntervalHoursSchema,
}

export const scalarProductSchema = z.object({
  ...productCommonSchema,
  kind: z.literal('scalar'),
  encoding: scalarEncodingSchema,
})

export const vectorProductSchema = z.object({
  ...productCommonSchema,
  kind: z.literal('vector'),
  encoding: vectorEncodingSchema,
})

export const manifestProductSchema = z.discriminatedUnion('kind', [
  scalarProductSchema,
  vectorProductSchema,
])

const cycleManifestPayloadSchema = z.object({
  schema: z.literal(MANIFEST_SCHEMA),
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  payloadContract: z.literal(MANIFEST_PAYLOAD_CONTRACT),
  model: modelSchema,
  run: runSchema,
  times: z.array(timeSchema).nonempty('expected at least one time'),
  products: z.record(z.string(), manifestProductSchema),
})

export const cycleManifestSchema = cycleManifestPayloadSchema
  .superRefine((manifest, ctx) => {
    const seenTimes = new Set<string>()
    for (const [timeIndex, time] of manifest.times.entries()) {
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

    const productEntries = Object.entries(manifest.products)
    if (productEntries.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['products'],
        message: 'expected at least one product',
      })
    }

    for (const [productId, product] of productEntries) {
      if (product.id !== productId) {
        ctx.addIssue({
          code: 'custom',
          path: ['products', productId, 'id'],
          message: `product key ${productId} does not match id ${product.id}`,
        })
      }

      for (const time of manifest.times) {
        if (product.frames[time.id]) continue
        ctx.addIssue({
          code: 'custom',
          path: ['products', productId, 'frames', time.id],
          message: `missing frame for hour ${time.id}`,
        })
      }
    }
  })
  .transform((manifest): CycleManifest => ({
    ...manifest,
    productsByKind: deriveProductsByKind(manifest.products),
  }))

export type ForecastModelSpec = z.infer<typeof modelSchema>
export type ForecastRunSpec = z.infer<typeof runSchema>
export type ForecastTimeSpec = z.infer<typeof timeSchema>
export type ScalarGridSpec = z.infer<typeof gridSchema>
export type ScalarLinearInt16EncodingSpec = z.infer<typeof scalarLinearInt16EncodingSchema>
export type ScalarLinearInt8EncodingSpec = z.infer<typeof scalarLinearInt8EncodingSchema>
export type ScalarTempCPiecewiseEncodingSpec = z.infer<typeof scalarTempCPiecewiseEncodingSchema>
export type ScalarEncodingSpec = z.infer<typeof scalarEncodingSchema>
export type VectorEncodingSpec = z.infer<typeof vectorEncodingSchema>
export type ManifestEncodingSpec = ScalarEncodingSpec | VectorEncodingSpec
export type FramePayloadRef = z.infer<typeof frameRefSchema>
export type ProductTemporalKind = typeof PRODUCT_TEMPORAL_KINDS[number]
export type ProductKind = ManifestProductSpec['kind']
export type ScalarProductSpec = z.infer<typeof scalarProductSchema>
export type VectorProductSpec = z.infer<typeof vectorProductSchema>
export type ManifestProductSpec = z.infer<typeof manifestProductSchema>
export type CycleManifest = z.infer<typeof cycleManifestPayloadSchema> & {
  productsByKind: Record<string, NonEmptyArray<ProductId>>
}

function deriveProductsByKind(products: Record<string, ManifestProductSpec>): Record<string, NonEmptyArray<ProductId>> {
  const productIdsByKind: Record<string, ProductId[]> = {}

  for (const product of Object.values(products)) {
    const productId = asProductId(product.id)
    productIdsByKind[product.kind] ??= []
    productIdsByKind[product.kind].push(productId)
  }

  const productsByKind: Record<string, NonEmptyArray<ProductId>> = {}
  for (const [kind, productIds] of Object.entries(productIdsByKind)) {
    productsByKind[kind] = productIds as NonEmptyArray<ProductId>
  }

  return productsByKind
}
