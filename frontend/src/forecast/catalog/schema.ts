import { z } from 'zod'

import catalogJson from '../../../../config/forecast_catalog.json'
import {
  DISPLAY_PROFILE_IDS,
} from '@/forecast/display'
import {
  contourSourceSchema,
  overlaySourceSchema,
  particleSourceSchema,
  rasterSourceSchema,
} from './source'

const idSchema = z.string().trim().min(1)
const nonEmptyLabelSchema = z.string().trim().min(1)

const rasterLayerSchema = z.object({
  id: idSchema,
  groupId: idSchema,
  displayProfile: z.enum(DISPLAY_PROFILE_IDS),
  source: rasterSourceSchema,
  overlays: z.array(idSchema).default([]),
}).strict()

const rasterLayerGroupSchema = z.object({
  id: idSchema,
  label: nonEmptyLabelSchema,
  rasterLayerIds: z.array(idSchema).nonempty(),
}).strict()

const particleLayerSchema = z.object({
  id: idSchema,
  label: nonEmptyLabelSchema,
  source: particleSourceSchema,
}).strict()

const contourLayerSchema = z.object({
  id: idSchema,
  label: nonEmptyLabelSchema,
  source: contourSourceSchema,
}).strict()

const overlayLayerSchema = overlaySourceSchema

const forecastCatalogSchema = z.object({
  catalogVersion: idSchema,
  rasterLayerGroups: z.array(rasterLayerGroupSchema).nonempty(),
  rasterLayers: z.array(rasterLayerSchema).nonempty(),
  overlayLayers: z.array(overlayLayerSchema).default([]),
  contourLayers: z.array(contourLayerSchema).default([]),
  particleLayers: z.array(particleLayerSchema).default([]),
}).strict().superRefine((catalog, ctx) => {
  addDuplicateIdIssues(ctx, catalog.rasterLayers, ['rasterLayers'], 'raster layer')
  addDuplicateIdIssues(ctx, catalog.rasterLayerGroups, ['rasterLayerGroups'], 'raster layer group')
  addDuplicateIdIssues(ctx, catalog.overlayLayers, ['overlayLayers'], 'overlay layer')
  addDuplicateIdIssues(ctx, catalog.contourLayers, ['contourLayers'], 'contour layer')
  addDuplicateIdIssues(ctx, catalog.particleLayers, ['particleLayers'], 'particle layer')

  const layerIds = new Set(catalog.rasterLayers.map((layer) => layer.id))
  const groupsById = new Map(catalog.rasterLayerGroups.map((group) => [group.id, group]))
  const overlayIds = new Set(catalog.overlayLayers.map((overlay) => overlay.id))
  for (const [groupIndex, group] of catalog.rasterLayerGroups.entries()) {
    for (const [layerIndex, layerId] of group.rasterLayerIds.entries()) {
      if (layerIds.has(layerId)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['rasterLayerGroups', groupIndex, 'rasterLayerIds', layerIndex],
        message: `group ${group.id} references missing layer ${layerId}`,
      })
    }
  }

  for (const [layerIndex, layer] of catalog.rasterLayers.entries()) {
    const group = groupsById.get(layer.groupId)
    if (!group) {
      ctx.addIssue({
        code: 'custom',
        path: ['rasterLayers', layerIndex, 'groupId'],
        message: `layer ${layer.id} references missing group ${layer.groupId}`,
      })
      continue
    }
    if (!group.rasterLayerIds.includes(layer.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rasterLayers', layerIndex, 'groupId'],
        message: `layer ${layer.id} is not listed in group ${layer.groupId}`,
      })
    }
    for (const [overlayIndex, overlayId] of layer.overlays.entries()) {
      if (overlayIds.has(overlayId)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['rasterLayers', layerIndex, 'overlays', overlayIndex],
        message: `layer ${layer.id} references missing overlay ${overlayId}`,
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
