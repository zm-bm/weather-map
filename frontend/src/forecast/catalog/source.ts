import { z } from 'zod'
import type { ReadonlyNonEmptyArray } from '@/core/types'

const idSchema = z.string().trim().min(1)
const finiteNumberSchema = z.number().finite()

export const displayRangeSchema = z.object({
  min: finiteNumberSchema,
  max: finiteNumberSchema,
}).superRefine((range, ctx) => {
  if (range.max > range.min) return
  ctx.addIssue({
    code: 'custom',
    path: ['max'],
    message: 'display range max must be greater than min',
  })
})

export const rasterBandSchema = z.object({
  id: idSchema,
  paletteId: idSchema,
}).strict()

export const sourceBandSchema = z.object({
  id: idSchema,
}).strict()

export const rasterSourceSchema = z.object({
  artifactId: idSchema,
  bands: z.array(rasterBandSchema).nonempty(),
}).strict()

export const loadSourceSchema = z.object({
  artifactId: idSchema,
  bands: z.array(sourceBandSchema).nonempty(),
}).strict()

export const overlaySourceSchema = z.object({
  id: idSchema,
  style: z.literal('precipitation-type-pattern'),
  source: loadSourceSchema,
  optional: z.boolean().default(false),
}).strict()

export const contourSourceSchema = loadSourceSchema
export const particleSourceSchema = loadSourceSchema

export type DisplayRange = z.infer<typeof displayRangeSchema>
export type RasterSource = z.infer<typeof rasterSourceSchema>
export type LoadSource = z.infer<typeof loadSourceSchema>
export type OverlaySource = z.infer<typeof overlaySourceSchema>
export type ContourSource = { id: string; source: LoadSource }
export type ParticleSource = { id: string; source: LoadSource }

export type ForecastLayerSource = RasterSource & {
  layerId: string
  displayRange: DisplayRange
  overlays: readonly OverlaySource[]
}

export function sourceBandIds(source: {
  bands: readonly { id: string }[]
}): ReadonlyNonEmptyArray<string> {
  const bandIds = source.bands.map((band) => band.id)
  const firstBandId = bandIds[0]
  if (firstBandId == null) {
    throw new Error('Expected at least one raster band id')
  }
  return [firstBandId, ...bandIds.slice(1)]
}

export function hasExactBandIds(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return actual.length === expected.length &&
    expected.every((bandId, index) => actual[index] === bandId)
}
