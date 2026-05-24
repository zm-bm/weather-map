import {
  asArtifactId,
  type ManifestArtifactSpec,
  type ArtifactId,
} from '@/forecast/manifest'
import {
  assertLegendScale,
  type LegendScale,
} from '@/forecast/legend'
import type { Brand, NonEmptyArray } from '@/core/types'
import {
  assertUnitBehavior,
  type UnitBehavior,
} from '@/forecast/units'
import { RAW_FORECAST_CATALOG } from './catalog'

export type LayerId = Brand<string, 'LayerId'>

export function asLayerId(value: string): LayerId {
  return value as LayerId
}

export type LayerGroupId = Brand<string, 'LayerGroupId'>

export function asLayerGroupId(value: string): LayerGroupId {
  return value as LayerGroupId
}

export type DisplayRangeSpec = {
  min: number
  max: number
}

export type ArtifactLayerSource = {
  kind: 'artifact'
  artifactId: ArtifactId
}

export type DerivedLayerSource = {
  kind: 'derived'
  artifactId: ArtifactId
  recipe: 'wind-speed'
}

export type CloudLayersSource = {
  kind: 'cloud-layers'
  artifactId: ArtifactId
}

export type LayerSource =
  | ArtifactLayerSource
  | DerivedLayerSource
  | CloudLayersSource

export type PrecipitationTypeLayerOverlay = {
  id: string
  kind: 'precipitation-type'
  artifactId: ArtifactId
  optional: boolean
}

export type LayerOverlaySpec = PrecipitationTypeLayerOverlay

export type LayerSpec = {
  id: LayerId
  label: string
  groupId: LayerGroupId
  paletteId: string
  displayRange: DisplayRangeSpec
  unitBehavior: UnitBehavior
  legendScale: LegendScale
  source: LayerSource
  overlays: readonly LayerOverlaySpec[]
  parameter?: string
}

export type LayerGroupSpec = {
  id: LayerGroupId
  label: string
  defaultLayer: LayerId
  layers: NonEmptyArray<LayerId>
}

type RawLayerSource =
  | {
    kind: 'artifact'
    artifactId: string
  }
  | {
    kind: 'derived'
    artifactId: string
    recipe: 'wind-speed'
  }
  | {
    kind: 'cloud-layers'
    artifactId: string
  }

type RawLayerOverlaySpec = {
  id: string
  kind: 'precipitation-type'
  artifactId: string
  optional?: boolean
}

type RawLayerSpec = {
  id: string
  label: string
  groupId: string
  paletteId: string
  displayRange: DisplayRangeSpec
  unitBehavior: string
  legendScale: string
  source: RawLayerSource
  overlays?: readonly RawLayerOverlaySpec[]
  parameter?: string
}

type RawLayerGroupSpec = {
  id: string
  label: string
  defaultLayer: string
  layers: string[]
}

type RawForecastCatalog = {
  layers: readonly RawLayerSpec[]
  groups: readonly RawLayerGroupSpec[]
}

export function layerSourceKey(source: LayerSource): string {
  if (source.kind === 'artifact') {
    return `artifact:${source.artifactId}`
  }
  if (source.kind === 'cloud-layers') {
    return `cloud-layers:${source.artifactId}`
  }
  return `derived:${source.recipe}:${source.artifactId}`
}

export function layerSourceArtifactId(source: LayerSource): ArtifactId {
  return source.artifactId
}

const rawCatalog = RAW_FORECAST_CATALOG as unknown as RawForecastCatalog

export const FORECAST_LAYERS: readonly LayerSpec[] = rawCatalog.layers.map(layerFromRaw)

export const FORECAST_LAYERS_BY_ID: Record<string, LayerSpec> = Object.fromEntries(
  FORECAST_LAYERS.map((entry) => [entry.id, entry])
)

export const FORECAST_LAYER_GROUPS: readonly LayerGroupSpec[] = rawCatalog.groups.map(groupFromRaw)

export function getLayerSpec(
  layerId: LayerId | string,
  layers: Record<string, LayerSpec>
): LayerSpec {
  const layer = layers[layerId]
  if (!layer) {
    throw new Error(`Missing layer catalog entry for ${layerId}`)
  }
  return layer
}

export function layerSourceExpectedArtifactKind(source: LayerSource): ManifestArtifactSpec['kind'] {
  if (source.kind === 'artifact') return 'scalar'
  return 'vector'
}

function layerFromRaw(raw: RawLayerSpec): LayerSpec {
  return {
    id: asLayerId(raw.id),
    label: raw.label,
    groupId: asLayerGroupId(raw.groupId),
    paletteId: raw.paletteId,
    displayRange: raw.displayRange,
    unitBehavior: assertUnitBehavior(raw.unitBehavior),
    legendScale: assertLegendScale(raw.legendScale),
    source: layerSourceFromRaw(raw.source),
    overlays: (raw.overlays ?? []).map(layerOverlayFromRaw),
    parameter: raw.parameter,
  }
}

function layerOverlayFromRaw(raw: RawLayerOverlaySpec): LayerOverlaySpec {
  return {
    id: raw.id,
    kind: raw.kind,
    artifactId: asArtifactId(raw.artifactId),
    optional: raw.optional ?? false,
  }
}

function layerSourceFromRaw(raw: RawLayerSource): LayerSource {
  if (raw.kind === 'artifact') {
    return { kind: 'artifact', artifactId: asArtifactId(raw.artifactId) }
  }
  if (raw.kind === 'cloud-layers') {
    return { kind: 'cloud-layers', artifactId: asArtifactId(raw.artifactId) }
  }

  return {
    kind: 'derived',
    artifactId: asArtifactId(raw.artifactId),
    recipe: raw.recipe,
  }
}

function groupFromRaw(raw: RawLayerGroupSpec): LayerGroupSpec {
  return {
    id: asLayerGroupId(raw.id),
    label: raw.label,
    defaultLayer: asLayerId(raw.defaultLayer),
    layers: raw.layers.map(asLayerId) as NonEmptyArray<LayerId>,
  }
}
