import {
  asProductId,
  type CycleManifest,
  type NonEmptyArray,
  type ProductId,
} from '../manifest'

type Brand<T, B extends string> = T & { readonly __brand: B }

export type ScalarLayerId = Brand<string, 'ScalarLayerId'>

export function asScalarLayerId(value: string): ScalarLayerId {
  return value as ScalarLayerId
}

export type DisplayRangeSpec = {
  min: number
  max: number
}

export type ScalarLayerSpec = {
  id: ScalarLayerId
  artifactId: ProductId
  label: string
  groupId: string
  paletteId: string
  displayRange: DisplayRangeSpec
}

export type ScalarLayerGroupSpec = {
  id: string
  label: string
  defaultLayer: ScalarLayerId
  layers: NonEmptyArray<ScalarLayerId>
}

export type AvailableScalarCatalog = {
  layers: Record<string, ScalarLayerSpec>
  groups: ScalarLayerGroupSpec[]
}

type ScalarLayerCatalogEntry = Omit<ScalarLayerSpec, 'id' | 'artifactId'> & {
  id: string
  artifactId: string
}

type ScalarLayerGroupCatalogEntry = {
  id: string
  label: string
  defaultLayer: string
  layers: NonEmptyArray<string>
}

const SCALAR_LAYER_CATALOG: ScalarLayerCatalogEntry[] = [
  layer('tmp_surface', 'Temperature', 'temperature', 'temperature.air.c.v1', -35, 50),
  layer('aptmp_surface', 'Apparent Temperature', 'temperature', 'temperature.air.c.v1', -35, 50),
  layer('dewpoint_surface', 'Dew Point', 'temperature', 'temperature.dewpoint.c.v1', -60, 40),
  layer('rh_surface', 'Relative Humidity', 'temperature', 'moisture.relative_humidity.percent.v1', 0, 100),
  layer('gust_surface', 'Wind Gust', 'wind', 'wind.gust.mps.v1', 0, 60),
  layer('prmsl_surface', 'Air Pressure', 'wind', 'pressure.msl.pa.v1', 98_000, 103_500),
  layer('prate_surface', 'Precipitation Rate', 'precipitation', 'precip.rate.mm_hr.v1', 0, 30),
  layer('precip_total_surface', 'Accumulated Precipitation', 'precipitation', 'precip.total.mm.v1', 0, 254),
  layer('snow_depth_surface', 'Snow Depth', 'precipitation', 'snow.depth.m.v1', 0, 5),
  layer('tcdc', 'Total Cloud Cover', 'atmosphere', 'cloud.cover.percent.v1', 0, 100),
  layer('low_clouds', 'Low Clouds', 'atmosphere', 'cloud.cover.percent.v1', 0, 100),
  layer('medium_clouds', 'Medium Clouds', 'atmosphere', 'cloud.cover.percent.v1', 0, 100),
  layer('high_clouds', 'High Clouds', 'atmosphere', 'cloud.cover.percent.v1', 0, 100),
  layer('visibility_surface', 'Visibility', 'atmosphere', 'atmosphere.visibility.m.v1', 0, 50_000),
  layer('freezing_level', 'Freezing Level', 'atmosphere', 'atmosphere.freezing_level.m.v1', 0, 8_000),
  layer('precipitable_water', 'Precipitable Water', 'atmosphere', 'atmosphere.precipitable_water.mm.v1', 0, 80),
  layer('cape_index', 'CAPE Index', 'severe', 'severe.cape.jkg.v1', 0, 5_000),
]

const SCALAR_GROUP_CATALOG: ScalarLayerGroupCatalogEntry[] = [
  group('temperature', 'Temperature', 'tmp_surface', ['tmp_surface', 'aptmp_surface', 'dewpoint_surface', 'rh_surface']),
  group('wind', 'Wind & Pressure', 'gust_surface', ['gust_surface', 'prmsl_surface']),
  group('precipitation', 'Precipitation', 'prate_surface', ['prate_surface', 'precip_total_surface', 'snow_depth_surface']),
  group('atmosphere', 'Atmosphere', 'tcdc', [
    'tcdc',
    'low_clouds',
    'medium_clouds',
    'high_clouds',
    'visibility_surface',
    'freezing_level',
    'precipitable_water',
  ]),
  group('severe', 'Severe', 'cape_index', ['cape_index']),
]

export function buildAvailableScalarCatalog(manifest: CycleManifest): AvailableScalarCatalog {
  const layers = availableScalarLayers(manifest)
  return {
    layers,
    groups: availableScalarGroups(layers),
  }
}

export function getScalarLayerSpec(
  layerId: ScalarLayerId | string,
  layers: Record<string, ScalarLayerSpec>
): ScalarLayerSpec {
  const layer = layers[layerId]
  if (!layer) {
    throw new Error(`Missing scalar layer catalog entry for ${layerId}`)
  }
  return layer
}

function availableScalarLayers(manifest: CycleManifest): Record<string, ScalarLayerSpec> {
  const layers: Record<string, ScalarLayerSpec> = {}

  for (const entry of SCALAR_LAYER_CATALOG) {
    const artifact = manifest.products[entry.artifactId]
    if (!artifact) continue
    if (artifact.kind !== 'scalar') {
      throw new Error(
        `Scalar catalog layer ${entry.id} requires scalar artifact ${entry.artifactId}, got ${artifact.kind}`
      )
    }
    layers[entry.id] = {
      id: asScalarLayerId(entry.id),
      artifactId: asProductId(entry.artifactId),
      label: entry.label,
      groupId: entry.groupId,
      paletteId: entry.paletteId,
      displayRange: entry.displayRange,
    }
  }

  return layers
}

function availableScalarGroups(layers: Record<string, ScalarLayerSpec>): ScalarLayerGroupSpec[] {
  return SCALAR_GROUP_CATALOG.flatMap((entry) => {
    const availableLayers = entry.layers
      .filter((layerId) => layers[layerId])
      .map(asScalarLayerId)
    if (availableLayers.length === 0) return []

    const defaultLayer = layers[entry.defaultLayer]
      ? asScalarLayerId(entry.defaultLayer)
      : availableLayers[0]!

    return [{
      id: entry.id,
      label: entry.label,
      defaultLayer,
      layers: availableLayers as NonEmptyArray<ScalarLayerId>,
    }]
  })
}

function layer(
  id: string,
  label: string,
  groupId: string,
  paletteId: string,
  min: number,
  max: number,
  artifactId = id
): ScalarLayerCatalogEntry {
  return {
    id,
    artifactId,
    label,
    groupId,
    paletteId,
    displayRange: { min, max },
  }
}

function group(
  id: string,
  label: string,
  defaultLayer: string,
  layers: NonEmptyArray<string>
): ScalarLayerGroupCatalogEntry {
  return {
    id,
    label,
    defaultLayer,
    layers,
  }
}
