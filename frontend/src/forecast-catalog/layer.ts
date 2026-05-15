import {
  asArtifactId,
  type CycleManifest,
  type ManifestArtifactSpec,
  type ArtifactId,
} from '../manifest'
import type { Brand, NonEmptyArray } from '../types'

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

export const FORECAST_LAYERS: readonly LayerSpec[] = [
  layer('temperature', 'Temperature', 'temperature', 'temperature.air.c.v1', -35, 50, 'temperature', 'temperature', {
    source: artifactSource('tmp_surface'),
  }),
  layer('apparent_temperature', 'Apparent Temperature', 'temperature', 'temperature.air.c.v1', -35, 50, 'temperature', 'temperature', {
    source: artifactSource('aptmp_surface'),
  }),
  layer('dew_point', 'Dew Point', 'temperature', 'temperature.dewpoint.c.v1', -60, 40, 'temperature', 'temperature', {
    source: artifactSource('dewpoint_surface'),
  }),
  layer('relative_humidity', 'Relative Humidity', 'temperature', 'moisture.relative_humidity.percent.v1', 0, 100, 'percent', 'percent', {
    source: artifactSource('rh_surface'),
  }),
  layer('wind_speed', 'Wind Speed', 'wind_pressure', 'wind.gust.mps.v1', 0, 60, 'wind-speed', 'stop-based', {
    source: {
      kind: 'derived',
      artifactId: asArtifactId('wind10m_uv'),
      recipe: 'wind-speed',
    },
    parameter: 'wind_speed',
  }),
  layer('wind_gust', 'Wind Gust', 'wind_pressure', 'wind.gust.mps.v1', 0, 60, 'wind-speed', 'stop-based', {
    source: artifactSource('gust_surface'),
  }),
  layer('air_pressure', 'Air Pressure', 'wind_pressure', 'pressure.msl.pa.v1', 98_000, 103_500, 'pressure', 'pressure', {
    source: artifactSource('prmsl_msl'),
  }),
  layer('precipitation_rate', 'Precipitation Rate', 'precipitation', 'precip.rate.mm_hr.v1', 0, 30, 'precip-rate', 'precip-rate', {
    source: {
      kind: 'composite',
      base: artifactSource('prate_surface'),
      overlays: [
        {
          id: 'precip-type',
          source: artifactSource('precip_type_surface'),
          optional: true,
        },
      ],
    },
    classifiedColoring: {
      classifierOverlayId: 'precip-type',
      classes: [
        { values: [1], paletteId: 'precip.rate.mm_hr.v1' },
        { values: [4], paletteId: 'precip.rate.snow.mm_hr.v1' },
        { values: [2, 3, 5], paletteId: 'precip.rate.wintry_mix.mm_hr.v1' },
      ],
    },
  }),
  layer('accumulated_precipitation', 'Accumulated Precipitation', 'precipitation', 'precip.total.mm.v1', 0, 254, 'precip-total', 'precip-total', {
    source: artifactSource('precip_total_surface'),
  }),
  layer('snow_depth', 'Snow Depth', 'precipitation', 'snow.depth.m.v1', 0, 5, 'snow-depth', 'stop-based', {
    source: artifactSource('snow_depth_surface'),
  }),
  layer('cloud_cover', 'Total Cloud Cover', 'sky_visibility', 'cloud.cover.percent.v1', 0, 100, 'percent', 'percent', {
    source: artifactSource('tcdc'),
  }),
  layer('low_cloud_cover', 'Low Cloud Cover', 'sky_visibility', 'cloud.cover.percent.v1', 0, 100, 'percent', 'percent', {
    source: artifactSource('low_clouds'),
  }),
  layer('middle_cloud_cover', 'Middle Cloud Cover', 'sky_visibility', 'cloud.cover.percent.v1', 0, 100, 'percent', 'percent', {
    source: artifactSource('medium_clouds'),
  }),
  layer('high_cloud_cover', 'High Cloud Cover', 'sky_visibility', 'cloud.cover.percent.v1', 0, 100, 'percent', 'percent', {
    source: artifactSource('high_clouds'),
  }),
  layer('visibility', 'Visibility', 'sky_visibility', 'atmosphere.visibility.m.v1', 0, 50_000, 'visibility', 'stop-based', {
    source: artifactSource('visibility_surface'),
  }),
  layer('freezing_level', 'Freezing Level', 'sky_visibility', 'atmosphere.freezing_level.m.v1', 0, 8_000, 'height', 'stop-based', {
    source: artifactSource('freezing_level'),
  }),
  layer('precipitable_water', 'Precipitable Water', 'sky_visibility', 'atmosphere.precipitable_water.mm.v1', 0, 80, 'water-depth', 'stop-based', {
    source: artifactSource('precipitable_water'),
  }),
  layer('cape', 'CAPE Index', 'severe_weather', 'severe.cape.jkg.v1', 0, 5_000, 'cape', 'stop-based', {
    source: artifactSource('cape_index'),
  }),
]

export const FORECAST_LAYER_GROUPS: readonly LayerGroupSpec[] = [
  group('temperature', 'Temperature', 'temperature', ['temperature', 'apparent_temperature', 'dew_point', 'relative_humidity']),
  group('wind_pressure', 'Wind & Pressure', 'wind_gust', ['wind_speed', 'wind_gust', 'air_pressure']),
  group('precipitation', 'Precipitation', 'precipitation_rate', ['precipitation_rate', 'accumulated_precipitation', 'snow_depth']),
  group('sky_visibility', 'Sky & Visibility', 'cloud_cover', [
    'cloud_cover',
    'low_cloud_cover',
    'middle_cloud_cover',
    'high_cloud_cover',
    'visibility',
    'freezing_level',
    'precipitable_water',
  ]),
  group('severe_weather', 'Severe Weather', 'cape', ['cape']),
]

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

export function getAvailableLayers(manifest: CycleManifest): Record<string, LayerSpec> {
  const layers: Record<string, LayerSpec> = {}

  for (const entry of FORECAST_LAYERS) {
    if (!isLayerAvailable(manifest, entry)) continue
    layers[entry.id] = entry
  }

  return layers
}

export function getAvailableGroups(layers: Record<string, LayerSpec>): LayerGroupSpec[] {
  return FORECAST_LAYER_GROUPS.flatMap((entry) => {
    const availableLayers = entry.layers
      .filter((layerId) => layers[layerId])
    if (availableLayers.length === 0) return []

    const defaultLayer = layers[entry.defaultLayer]
      ? entry.defaultLayer
      : availableLayers[0]!

    return [{
      id: entry.id,
      label: entry.label,
      defaultLayer,
      layers: availableLayers as NonEmptyArray<LayerId>,
    }]
  })
}

export function layerSourceExpectedArtifactKind(source: LayerSource): ManifestArtifactSpec['kind'] {
  if (source.kind === 'artifact') return 'scalar'
  if (source.kind === 'derived') return 'vector'
  return layerSourceExpectedArtifactKind(source.base)
}

function layer(
  id: string,
  label: string,
  groupId: string,
  paletteId: string,
  min: number,
  max: number,
  unitBehavior: UnitBehaviorId,
  legendScale: LegendScaleId,
  options: {
    source: LayerSource
    parameter?: string
    classifiedColoring?: ClassifiedColoringSpec
  }
): LayerSpec {
  return {
    id: asLayerId(id),
    label,
    groupId: asLayerGroupId(groupId),
    paletteId,
    displayRange: { min, max },
    unitBehavior,
    legendScale,
    source: options.source,
    parameter: options.parameter,
    classifiedColoring: options.classifiedColoring,
  }
}

function artifactSource(artifactId: string): ArtifactLayerSource {
  return { kind: 'artifact', artifactId: asArtifactId(artifactId) }
}

function isLayerAvailable(manifest: CycleManifest, layer: LayerSpec): boolean {
  return isLayerSourceAvailable(manifest, layer.source, `Layer ${layer.id}`)
}

function isLayerSourceAvailable(
  manifest: CycleManifest,
  source: LayerSource,
  owner: string
): boolean {
  if (source.kind === 'composite') {
    return isLayerSourceAvailable(manifest, source.base, owner) &&
      source.overlays.every((overlay) => isCompositeOverlayAvailable(manifest, overlay, owner))
  }

  const expectedKind = layerSourceExpectedArtifactKind(source)
  const artifact = manifest.artifacts[source.artifactId]
  if (!artifact) return false
  if (artifact.kind !== expectedKind) {
    throw new Error(`${owner} requires ${expectedKind} artifact ${source.artifactId}, got ${artifact.kind}`)
  }

  if (source.kind === 'derived' && source.recipe === 'wind-speed') {
    return hasOrderedComponents(artifact, ['u', 'v'])
  }

  return true
}

function isCompositeOverlayAvailable(
  manifest: CycleManifest,
  overlay: CompositeLayerOverlaySource,
  owner: string
): boolean {
  const artifact = manifest.artifacts[overlay.source.artifactId]
  if (!artifact) return overlay.optional
  if (artifact.kind !== 'scalar') {
    throw new Error(`${owner} overlay ${overlay.id} requires scalar artifact ${overlay.source.artifactId}, got ${artifact.kind}`)
  }
  return true
}

function hasOrderedComponents(
  artifact: ManifestArtifactSpec,
  components: readonly string[]
): boolean {
  return artifact.components.length === components.length &&
    components.every((component, index) => artifact.components[index] === component)
}

function group(
  id: string,
  label: string,
  defaultLayer: string,
  layers: NonEmptyArray<string>
): LayerGroupSpec {
  return {
    id: asLayerGroupId(id),
    label,
    defaultLayer: asLayerId(defaultLayer),
    layers: layers.map(asLayerId) as NonEmptyArray<LayerId>,
  }
}
