import { z } from 'zod'

import { isLegendScale } from '@/forecast/legend'
import { isLayerPaletteId } from '@/forecast/palette'
import catalogJson from '../../../../config/forecast_catalog.json'

const idSchema = z.string().trim().min(1)
const nonEmptyLabelSchema = z.string().trim().min(1)
const finiteNumberSchema = z.number().finite()

const displayRangeSchema = z.object({
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

const artifactLayerSourceSchema = z.object({
  kind: z.literal('artifact'),
  artifactId: idSchema,
})

const derivedLayerSourceSchema = z.object({
  kind: z.literal('derived'),
  artifactId: idSchema,
  recipe: z.literal('wind-speed'),
})

const cloudLayersSourceSchema = z.object({
  kind: z.literal('cloud-layers'),
  artifactId: idSchema,
})

const layerSourceSchema = z.discriminatedUnion('kind', [
  artifactLayerSourceSchema,
  derivedLayerSourceSchema,
  cloudLayersSourceSchema,
])

const layerOverlaySchema = z.object({
  id: idSchema,
  kind: z.literal('precipitation-type'),
  artifactId: idSchema,
  optional: z.boolean().optional(),
})

const layerSchema = z.object({
  id: idSchema,
  label: nonEmptyLabelSchema,
  groupId: idSchema,
  paletteId: idSchema,
  displayRange: displayRangeSchema,
  unitBehavior: idSchema,
  legendScale: idSchema,
  source: layerSourceSchema,
  overlays: z.array(layerOverlaySchema).optional(),
  parameter: idSchema.optional(),
})

const groupSchema = z.object({
  id: idSchema,
  label: nonEmptyLabelSchema,
  defaultLayer: idSchema,
  layers: z.array(idSchema).nonempty(),
})

const particleLayerSchema = z.object({
  id: idSchema,
  label: nonEmptyLabelSchema,
  source: z.object({
    kind: z.literal('artifact'),
    artifactId: idSchema,
  }),
})

const forecastCatalogSchema = z.object({
  catalogVersion: idSchema,
  groups: z.array(groupSchema).nonempty(),
  layers: z.array(layerSchema).nonempty(),
  particleLayers: z.array(particleLayerSchema).default([]),
}).superRefine((catalog, ctx) => {
  addDuplicateIdIssues(ctx, catalog.layers, ['layers'], 'layer')
  addDuplicateIdIssues(ctx, catalog.groups, ['groups'], 'group')
  addDuplicateIdIssues(ctx, catalog.particleLayers, ['particleLayers'], 'particle layer')

  const layerIds = new Set(catalog.layers.map((layer) => layer.id))
  const groupsById = new Map(catalog.groups.map((group) => [group.id, group]))
  for (const [groupIndex, group] of catalog.groups.entries()) {
    if (!layerIds.has(group.defaultLayer)) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups', groupIndex, 'defaultLayer'],
        message: `group ${group.id} default layer ${group.defaultLayer} is not defined`,
      })
    }
    for (const [layerIndex, layerId] of group.layers.entries()) {
      if (layerIds.has(layerId)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['groups', groupIndex, 'layers', layerIndex],
        message: `group ${group.id} references missing layer ${layerId}`,
      })
    }
  }

  for (const [layerIndex, layer] of catalog.layers.entries()) {
    const group = groupsById.get(layer.groupId)
    if (!group) {
      ctx.addIssue({
        code: 'custom',
        path: ['layers', layerIndex, 'groupId'],
        message: `layer ${layer.id} references missing group ${layer.groupId}`,
      })
      continue
    }
    if (!group.layers.includes(layer.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layers', layerIndex, 'groupId'],
        message: `layer ${layer.id} is not listed in group ${layer.groupId}`,
      })
    }
    if (!isLayerPaletteId(layer.paletteId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layers', layerIndex, 'paletteId'],
        message: `layer ${layer.id} references unknown palette ${layer.paletteId}`,
      })
    }
    if (!isLegendScale(layer.legendScale)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layers', layerIndex, 'legendScale'],
        message: `layer ${layer.id} references unknown legend scale ${layer.legendScale}`,
      })
    }
  }
})

export type RawForecastCatalog = z.infer<typeof forecastCatalogSchema>

export function parseForecastCatalog(value: unknown): RawForecastCatalog {
  return forecastCatalogSchema.parse(value)
}

export const FORECAST_CATALOG = parseForecastCatalog(catalogJson)

function addDuplicateIdIssues(
  ctx: z.RefinementCtx,
  entries: readonly { id: string }[],
  path: string[],
  label: string,
) {
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id)
      continue
    }
    ctx.addIssue({
      code: 'custom',
      path: [...path, index, 'id'],
      message: `duplicate ${label} id ${entry.id}`,
    })
  }
}
