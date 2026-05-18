import {
  asArtifactId,
  type ManifestArtifactSpec,
  type ArtifactId,
} from '../forecast-manifest'
import type { Brand, NonEmptyArray } from '../types'
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

export type UnitBehaviorId =
  | 'temperature'
  | 'wind-speed'
  | 'percent'
  | 'pressure'
  | 'precip-rate'
  | 'precip-total'
  | 'snow-depth'
  | 'visibility'
  | 'height'
  | 'water-depth'
  | 'cape'

export type LegendScaleId =
  | 'temperature'
  | 'percent'
  | 'pressure'
  | 'precip-rate'
  | 'precip-total'
  | 'stop-based'

export type ArtifactLayerSource = {
  kind: 'artifact'
  artifactId: ArtifactId
}

export type DerivedLayerSource = {
  kind: 'derived'
  artifactId: ArtifactId
  recipe: 'wind-speed'
}

export type CompositeLayerOverlaySource = {
  id: string
  source: ArtifactLayerSource
  optional: boolean
}

export type CompositeLayerSource = {
  kind: 'composite'
  base: LayerSource
  overlays: readonly CompositeLayerOverlaySource[]
}

export type LayerSource =
  | ArtifactLayerSource
  | DerivedLayerSource
  | CompositeLayerSource

export type ClassifiedColoringClassSpec = {
  values: readonly number[]
  paletteId: string
}

export type ClassifiedColoringSpec = {
  classifierOverlayId: string
  classes: readonly ClassifiedColoringClassSpec[]
}

export type LayerSpec = {
  id: LayerId
  label: string
  groupId: LayerGroupId
  paletteId: string
  displayRange: DisplayRangeSpec
  unitBehavior: UnitBehaviorId
  legendScale: LegendScaleId
  source: LayerSource
  parameter?: string
  classifiedColoring?: ClassifiedColoringSpec
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
    kind: 'composite'
    base: RawLayerSource
    overlays: readonly {
      id: string
      source: Extract<RawLayerSource, { kind: 'artifact' }>
      optional: boolean
    }[]
  }

type RawLayerSpec = {
  id: string
  label: string
  groupId: string
  paletteId: string
  displayRange: DisplayRangeSpec
  unitBehavior: UnitBehaviorId
  legendScale: LegendScaleId
  source: RawLayerSource
  parameter?: string
  classifiedColoring?: ClassifiedColoringSpec
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
  if (source.kind === 'derived') {
    return `derived:${source.recipe}:${source.artifactId}`
  }

  return `composite:${layerSourceKey(source.base)}:${source.overlays.map((overlay) => (
    `${overlay.id}:${overlay.optional ? 'optional' : 'required'}:${layerSourceKey(overlay.source)}`
  )).join(',')}`
}

export function layerSourceArtifactId(source: LayerSource): ArtifactId {
  if (source.kind === 'artifact' || source.kind === 'derived') {
    return source.artifactId
  }

  return layerSourceArtifactId(source.base)
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
  if (source.kind === 'derived') return 'vector'
  return layerSourceExpectedArtifactKind(source.base)
}

function layerFromRaw(raw: RawLayerSpec): LayerSpec {
  return {
    id: asLayerId(raw.id),
    label: raw.label,
    groupId: asLayerGroupId(raw.groupId),
    paletteId: raw.paletteId,
    displayRange: raw.displayRange,
    unitBehavior: raw.unitBehavior,
    legendScale: raw.legendScale,
    source: layerSourceFromRaw(raw.source),
    parameter: raw.parameter,
    classifiedColoring: raw.classifiedColoring,
  }
}

function layerSourceFromRaw(raw: RawLayerSource): LayerSource {
  if (raw.kind === 'artifact') {
    return { kind: 'artifact', artifactId: asArtifactId(raw.artifactId) }
  }

  if (raw.kind === 'derived') {
    return {
      kind: 'derived',
      artifactId: asArtifactId(raw.artifactId),
      recipe: raw.recipe,
    }
  }

  return {
    kind: 'composite',
    base: layerSourceFromRaw(raw.base),
    overlays: raw.overlays.map((overlay) => ({
      id: overlay.id,
      source: layerSourceFromRaw(overlay.source) as ArtifactLayerSource,
      optional: overlay.optional,
    })),
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
