import { z } from 'zod'
import type { ReadonlyNonEmptyArray } from '@/core/types'
import type { ForecastDisplayProfile } from '@/forecast/display'

const idSchema = z.string().trim().min(1)

export const artifactBandSchema = z.object({
  id: idSchema,
}).strict()

export const artifactSourceSchema = z.object({
  artifactId: idSchema,
  bands: z.array(artifactBandSchema).nonempty(),
}).strict()

export const overlaySourceSchema = z.object({
  id: idSchema,
  style: z.literal('precipitation-type-pattern'),
  source: artifactSourceSchema,
  optional: z.boolean().default(false),
}).strict()

export const contourSourceSchema = artifactSourceSchema
export const particleSourceSchema = artifactSourceSchema

export type ArtifactSource = z.infer<typeof artifactSourceSchema>
export type OverlaySource = z.infer<typeof overlaySourceSchema>
export type ContourSource = { id: string; source: ArtifactSource }
export type ParticleSource = { id: string; source: ArtifactSource }

export type ForecastLayerSource = ArtifactSource & {
  layerId: string
  display: ForecastDisplayProfile
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
