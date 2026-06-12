import type { NonEmptyArray } from '@/core/types'
import {
  getDisplayProfile,
  type DisplayProfileId,
  type ForecastDisplayProfile,
} from '@/forecast/display'
import {
  type ArtifactSource,
  type ForecastLayerSource,
  type OverlaySource,
} from './source'
import { FORECAST_CATALOG } from './schema'

export type ForecastRasterLayer = {
  id: string
  groupId: string
  displayProfile: DisplayProfileId
  display: ForecastDisplayProfile
  label: string
  source: ArtifactSource
  overlays: readonly OverlaySource[]
}

export type ForecastRasterLayerGroup = {
  id: string
  label: string
  rasterLayerIds: NonEmptyArray<string>
}

export type ParticleLayer = {
  id: string
  label: string
  source: ArtifactSource
}

export type ContourLayer = {
  id: string
  label: string
  source: ArtifactSource
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
    display: layer.display,
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

export function forecastRasterLayerLabel(layer: ForecastRasterLayer): string {
  return layer.label
}

function layerFromRaw(raw: RawForecastRasterLayer): ForecastRasterLayer {
  const display = getDisplayProfile(raw.displayProfile)
  return {
    id: raw.id,
    groupId: raw.groupId,
    displayProfile: raw.displayProfile,
    display,
    label: display.label,
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
