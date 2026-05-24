import type {
  GeoJSONFeature,
  GeoJSONSource,
  GeoJSONSourceDiff,
  LayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'

import {
  BASEMAP_SOURCE_ID,
  BASEMAP_SOURCE_LAYER_IDS,
} from '@/map/basemap'
import type {
  PlaceProbeBounds,
  PlaceProbeProject,
  PlaceProbeScreenPoint,
} from './places'

type PlaceProbeFeatureProperties = {
  id: string
  name: string
  localName: string
  sortKey: number
  probeText: string
}

type PlaceProbeFeature = Feature<Point, PlaceProbeFeatureProperties>
type PlaceProbeFeatureCollection = FeatureCollection<Point, PlaceProbeFeatureProperties>

type PlaceProbeSelectionContext = {
  bounds: PlaceProbeBounds | null
  project: PlaceProbeProject | null
}

export type PlaceProbeValueLabel = {
  id: string
  name: string
  localName: string | null
  lon: number
  lat: number
  sortKey: number
  probeText: string
}

export type PlaceProbeLabelSnapshot = Map<string, PlaceProbeValueLabel>

const FORECAST_PLACE_PROBE_SOURCE_ID = 'forecast-place-probes' as const
const FORECAST_PLACE_PROBE_LAYER_ID = 'forecast-place-probe-labels' as const
const FORECAST_PLACE_PROBE_LABEL_LAYER_IDS = [FORECAST_PLACE_PROBE_LAYER_ID] as const

export const placeProbeLayerIds = {
  source: FORECAST_PLACE_PROBE_SOURCE_ID,
  layer: FORECAST_PLACE_PROBE_LAYER_ID,
  labelLayers: FORECAST_PLACE_PROBE_LABEL_LAYER_IDS,
} as const

const PLACE_LABEL_FONT_STACK = 'NotoSansMonoCJKjpRegular'
const PLACE_PROBE_FORMAT = {
  'font-scale': 1.15,
  'text-color':'#e9cf3a',
}

const PLACE_PROBE_LAYER: LayerSpecification = {
  id: placeProbeLayerIds.layer,
  type: 'symbol',
  source: placeProbeLayerIds.source,
  minzoom: 3.5,
  layout: {
    'symbol-sort-key': ['get', 'sortKey'],
    'text-field': [
      'case',
      ['!=', ['get', 'localName'], ''],
      [
        'format',
        ['get', 'name'], {},
        '\n', {},
        ['get', 'localName'], {},
        '\n', {},
        ['get', 'probeText'], PLACE_PROBE_FORMAT,
      ],
      [
        'format',
        ['get', 'name'], {},
        '\n', {},
        ['get', 'probeText'], PLACE_PROBE_FORMAT,
      ],
    ],
    'text-font': [PLACE_LABEL_FONT_STACK],
    'text-justify': 'auto',
    'text-letter-spacing': 0.01,
    'text-line-height': 1.05,
    'text-max-width': 10,
    'text-overlap': 'never',
    'text-padding': 1,
    'text-radial-offset': 0.5,
    'text-size': [
      'interpolate', ['exponential', 1.2], ['zoom'],
      3, 14,
      7, 16,
      10, 20,
    ],
    'text-variable-anchor': [
      'center',
      'bottom',
      'top',
      'right',
      'left',
      'bottom-right',
      'bottom-left',
      'top-right',
      'top-left',
    ],
  },
  paint: {
    'text-color': [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      'rgba(255, 255, 255, 1)',
      'rgba(244, 247, 255, 0.96)',
    ],
    'text-halo-blur': 0.7,
    'text-halo-color': [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      'rgba(16, 24, 44, 1)',
      'rgba(27, 35, 60, 0.96)',
    ],
    'text-halo-width': [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      2.35,
      1.75,
    ],
  },
}

function ensurePlaceProbeLayer(map: MapLibreMap): void {
  if (!map.getSource(placeProbeLayerIds.source)) {
    map.addSource(placeProbeLayerIds.source, {
      type: 'geojson',
      data: createEmptyPlaceProbeCollection(),
    })
  }

  if (!map.getLayer(placeProbeLayerIds.layer)) {
    map.addLayer(PLACE_PROBE_LAYER)
  }
}

function removePlaceProbeLayer(map: MapLibreMap): void {
  if (hasMapLayer(map, placeProbeLayerIds.layer)) {
    tryMapStyleOperation(map, () => map.removeLayer(placeProbeLayerIds.layer))
  }
  if (hasMapSource(map, placeProbeLayerIds.source)) {
    tryMapStyleOperation(map, () => map.removeSource(placeProbeLayerIds.source))
  }
}

function hasMapLayer(map: MapLibreMap, layerId: string): boolean {
  return tryMapStyleOperation(map, () => map.getLayer(layerId) != null) ?? false
}

function hasMapSource(map: MapLibreMap, sourceId: string): boolean {
  return tryMapStyleOperation(map, () => map.getSource(sourceId) != null) ?? false
}

export function tryMapStyleOperation<T>(
  map: MapLibreMap,
  operation: () => T,
): T | null {
  if (isMapStyleUnavailable(map)) return null

  try {
    return operation()
  } catch (error) {
    if (isMapStyleUnavailableError(error)) return null
    throw error
  }
}

function isMapStyleUnavailable(map: MapLibreMap): boolean {
  const candidate = map as MapLibreMap & {
    _removed?: boolean
    style?: unknown | null
  }
  return candidate._removed === true || ('style' in candidate && candidate.style == null)
}

function isMapStyleUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /Cannot read properties of (undefined|null) \(reading '(getLayer|getSource|removeLayer|removeSource|setFeatureState)'\)/.test(
    error.message,
  ) || /source ["'][^"']+["'] does not exist in the map's style/i.test(error.message)
}

function queryBasemapPlaceFeatures(map: MapLibreMap): GeoJSONFeature[] {
  return map.querySourceFeatures(BASEMAP_SOURCE_ID, {
    sourceLayer: BASEMAP_SOURCE_LAYER_IDS.places,
  })
}

function getMapBounds(map: MapLibreMap): PlaceProbeBounds | null {
  const getBounds = (map as MapLibreMap & { getBounds?: () => PlaceProbeBounds }).getBounds
  return getBounds?.call(map) ?? null
}

function getPlaceProbeSelectionContext(map: MapLibreMap): PlaceProbeSelectionContext {
  return {
    bounds: getMapBounds(map),
    project: createPlaceProbeProjector(map),
  }
}

function createPlaceProbeProjector(map: MapLibreMap): PlaceProbeProject | null {
  const project = (map as MapLibreMap & {
    project?: (lngLat: [number, number]) => PlaceProbeScreenPoint
  }).project

  if (typeof project !== 'function') return null

  return (point) => {
    const screenPoint = project.call(map, [point.lon, point.lat])
    if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return null
    return {
      x: screenPoint.x,
      y: screenPoint.y,
    }
  }
}

function setPlaceProbeLabels(
  map: MapLibreMap,
  labels: PlaceProbeValueLabel[],
): PlaceProbeLabelSnapshot {
  const source = getPlaceProbeSource(map)
  if (source == null) return new Map()

  const sourceData = buildPlaceProbeCollection(labels)
  source.setData(sourceData.collection)
  return sourceData.labelsByPlaceId
}

function updatePlaceProbeLabels(
  map: MapLibreMap,
  labels: PlaceProbeValueLabel[],
  previousLabelsByPlaceId: ReadonlyMap<string, PlaceProbeValueLabel>,
): PlaceProbeLabelSnapshot {
  const source = getPlaceProbeSource(map)
  if (source == null) return new Map()

  const labelUpdate = buildPlaceProbeLabelDiff(labels, previousLabelsByPlaceId)
  if (labelUpdate.diff != null) {
    source.updateData(labelUpdate.diff)
  }
  return labelUpdate.labelsByPlaceId
}

function getPlaceProbeSource(map: MapLibreMap): GeoJSONSource | null {
  return (map.getSource(placeProbeLayerIds.source) as GeoJSONSource | undefined) ?? null
}

function createEmptyPlaceProbeCollection(): PlaceProbeFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function buildPlaceProbeCollection(labels: PlaceProbeValueLabel[]): {
  collection: PlaceProbeFeatureCollection
  labelsByPlaceId: PlaceProbeLabelSnapshot
} {
  const labelsByPlaceId = new Map<string, PlaceProbeValueLabel>()

  return {
    collection: {
      type: 'FeatureCollection',
      features: labels.map((label) => {
        labelsByPlaceId.set(label.id, label)
        return buildPlaceProbeFeature(label)
      }),
    },
    labelsByPlaceId,
  }
}

function buildPlaceProbeLabelDiff(
  labels: PlaceProbeValueLabel[],
  previousLabelsByPlaceId: ReadonlyMap<string, PlaceProbeValueLabel>,
) {
  const remove: NonNullable<GeoJSONSourceDiff['remove']> = []
  const add: NonNullable<GeoJSONSourceDiff['add']> = []
  const update: NonNullable<GeoJSONSourceDiff['update']> = []
  const labelsByPlaceId = new Map<string, PlaceProbeValueLabel>()

  for (const label of labels) {
    labelsByPlaceId.set(label.id, label)
    const previousLabel = previousLabelsByPlaceId.get(label.id)

    if (previousLabel == null) {
      add.push(buildPlaceProbeFeature(label))
      continue
    }

    const labelDiff = buildPlaceProbeFeatureDiff(label, previousLabel)
    if (labelDiff != null) update.push(labelDiff)
  }

  for (const previousId of previousLabelsByPlaceId.keys()) {
    if (!labelsByPlaceId.has(previousId)) {
      remove.push(previousId)
    }
  }

  return {
    diff: remove.length > 0 || add.length > 0 || update.length > 0
      ? {
        ...(remove.length > 0 ? { remove } : null),
        ...(add.length > 0 ? { add } : null),
        ...(update.length > 0 ? { update } : null),
      }
      : null,
    labelsByPlaceId,
  }
}

function buildPlaceProbeFeatureDiff(
  label: PlaceProbeValueLabel,
  previousLabel: PlaceProbeValueLabel,
): NonNullable<GeoJSONSourceDiff['update']>[number] | null {
  const addOrUpdateProperties: NonNullable<NonNullable<GeoJSONSourceDiff['update']>[number]['addOrUpdateProperties']> = []
  const coordinatesChanged = label.lon !== previousLabel.lon || label.lat !== previousLabel.lat

  if (label.name !== previousLabel.name) {
    addOrUpdateProperties.push({ key: 'name', value: label.name })
  }
  if (label.localName !== previousLabel.localName) {
    addOrUpdateProperties.push({ key: 'localName', value: label.localName ?? '' })
  }
  if (label.sortKey !== previousLabel.sortKey) {
    addOrUpdateProperties.push({ key: 'sortKey', value: label.sortKey })
  }
  if (label.probeText !== previousLabel.probeText) {
    addOrUpdateProperties.push({ key: 'probeText', value: label.probeText })
  }

  if (!coordinatesChanged && addOrUpdateProperties.length === 0) return null

  return {
    id: label.id,
    ...(coordinatesChanged
      ? {
        newGeometry: {
          type: 'Point' as const,
          coordinates: [label.lon, label.lat],
        },
      }
      : null),
    ...(addOrUpdateProperties.length > 0 ? { addOrUpdateProperties } : null),
  }
}

function buildPlaceProbeFeature(label: PlaceProbeValueLabel): PlaceProbeFeature {
  return {
    type: 'Feature',
    id: label.id,
    geometry: {
      type: 'Point',
      coordinates: [label.lon, label.lat],
    },
    properties: {
      id: label.id,
      name: label.name,
      localName: label.localName ?? '',
      sortKey: label.sortKey,
      probeText: label.probeText,
    },
  }
}

export const placeProbeLayer = {
  ensure: ensurePlaceProbeLayer,
  remove: removePlaceProbeLayer,
  queryBasemapPlaces: queryBasemapPlaceFeatures,
  getBounds: getMapBounds,
  getSelectionContext: getPlaceProbeSelectionContext,
  setLabels: setPlaceProbeLabels,
  updateLabels: updatePlaceProbeLabels,
} as const
