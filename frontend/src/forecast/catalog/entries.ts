import {
  assertLegendScale,
  type LegendScale,
} from '@/forecast/legend'
import type { NonEmptyArray } from '@/core/types'
import {
  type DisplayRange,
  type ForecastLayerSource,
  type LoadSource,
  type OverlaySource,
  type RasterSource,
} from './source'
import {
  assertUnitBehavior,
  type UnitBehavior,
} from '@/forecast/units'
import { FORECAST_CATALOG } from './schema'

export type ForecastRasterLayer = {
  id: string
  groupId: string
  display: ForecastRasterLayerDisplay
  source: RasterSource
  overlays: readonly OverlaySource[]
}

export type ForecastRasterLayerDisplay = {
  label: string
  range: DisplayRange
  unitBehavior: UnitBehavior
  legendScale: LegendScale
  parameter?: string
}

export type ForecastRasterLayerGroup = {
  id: string
  label: string
  rasterLayerIds: NonEmptyArray<string>
}

export type ParticleLayer = {
  id: string
  label: string
  source: LoadSource
}

export type ContourLayer = {
  id: string
  label: string
  source: LoadSource
}

type RawForecastRasterLayer = typeof FORECAST_CATALOG.rasterLayers[number]
type RawForecastRasterLayerGroup = typeof FORECAST_CATALOG.rasterLayerGroups[number]
type RawOverlayLayer = typeof FORECAST_CATALOG.overlayLayers[number]
type RawContourLayer = typeof FORECAST_CATALOG.contourLayers[number]
type RawParticleLayer = typeof FORECAST_CATALOG.particleLayers[number]

const rawCatalog = FORECAST_CATALOG

export const OVERLAY_LAYERS: readonly OverlaySource[] = rawCatalog.overlayLayers.map(overlayLayerFromRaw)

const OVERLAY_LAYERS_BY_ID: Record<string, OverlaySource> = Object.fromEntries(
  OVERLAY_LAYERS.map((entry) => [entry.id, entry])
)

export const FORECAST_RASTER_LAYERS: readonly ForecastRasterLayer[] = rawCatalog.rasterLayers.map(layerFromRaw)

export const FORECAST_RASTER_LAYERS_BY_ID: Record<string, ForecastRasterLayer> = Object.fromEntries(
  FORECAST_RASTER_LAYERS.map((entry) => [entry.id, entry])
)

export const FORECAST_RASTER_LAYER_GROUPS: readonly ForecastRasterLayerGroup[] = rawCatalog.rasterLayerGroups.map(groupFromRaw)

export const CONTOUR_LAYERS: readonly ContourLayer[] = rawCatalog.contourLayers.map(contourLayerFromRaw)

export const PARTICLE_LAYERS: readonly ParticleLayer[] = rawCatalog.particleLayers.map(particleLayerFromRaw)

export function getDefaultRasterLayerId(): string | null {
  return FORECAST_RASTER_LAYER_GROUPS[0]?.rasterLayerIds[0] ?? null
}

export function forecastRasterLayerSourceFromLayer(layer: ForecastRasterLayer): ForecastLayerSource {
  return {
    layerId: layer.id,
    displayRange: layer.display.range,
    overlays: layer.overlays,
    artifactId: layer.source.artifactId,
    bands: layer.source.bands,
  }
}

export function getForecastRasterLayer(
  layerId: string | null,
  layersById: Record<string, ForecastRasterLayer> = FORECAST_RASTER_LAYERS_BY_ID,
): ForecastRasterLayer | null {
  return layerId == null ? null : layersById[layerId] ?? null
}

export function requireForecastRasterLayer(
  layerId: string,
  layersById: Record<string, ForecastRasterLayer> = FORECAST_RASTER_LAYERS_BY_ID,
): ForecastRasterLayer {
  const layer = getForecastRasterLayer(layerId, layersById)
  if (!layer) {
    throw new Error(`Missing layer catalog entry for ${layerId}`)
  }
  return layer
}

function layerFromRaw(raw: RawForecastRasterLayer): ForecastRasterLayer {
  const display: ForecastRasterLayerDisplay = {
    label: raw.display.label,
    range: raw.display.range,
    unitBehavior: assertUnitBehavior(raw.display.unitBehavior),
    legendScale: assertLegendScale(raw.display.legendScale),
  }
  if (raw.display.parameter !== undefined) {
    display.parameter = raw.display.parameter
  }

  return {
    id: raw.id,
    groupId: raw.groupId,
    display,
    source: raw.source,
    overlays: raw.overlays.map((overlayId) => requireOverlayLayer(overlayId)),
  }
}

function groupFromRaw(raw: RawForecastRasterLayerGroup): ForecastRasterLayerGroup {
  return {
    id: raw.id,
    label: raw.label,
    rasterLayerIds: raw.rasterLayerIds as NonEmptyArray<string>,
  }
}

function overlayLayerFromRaw(raw: RawOverlayLayer): OverlaySource {
  return {
    id: raw.id,
    style: raw.style,
    source: raw.source,
    optional: raw.optional,
  }
}

function requireOverlayLayer(overlayId: string): OverlaySource {
  const overlay = OVERLAY_LAYERS_BY_ID[overlayId]
  if (!overlay) {
    throw new Error(`Missing overlay catalog entry for ${overlayId}`)
  }
  return overlay
}

function contourLayerFromRaw(raw: RawContourLayer): ContourLayer {
  return {
    id: raw.id,
    label: raw.label,
    source: raw.source,
  }
}

function particleLayerFromRaw(raw: RawParticleLayer): ParticleLayer {
  return {
    id: raw.id,
    label: raw.label,
    source: raw.source,
  }
}
