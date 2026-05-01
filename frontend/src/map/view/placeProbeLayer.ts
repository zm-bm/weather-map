import type {
  GeoJSONFeature,
  GeoJSONSource,
  GeoJSONSourceDiff,
  LayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'

import { basemapLayerIds, placeProbeLayerIds } from './constants'

type PlaceProbeFeatureProperties = {
  id: string
  name: string
  sortKey: number
  probeText: string
}

type PlaceProbeFeature = Feature<Point, PlaceProbeFeatureProperties>
type PlaceProbeFeatureCollection = FeatureCollection<Point, PlaceProbeFeatureProperties>

type PlaceProbeBounds = {
  contains: (lngLat: [number, number]) => boolean
}

type PlaceProbePoint = {
  lon: number
  lat: number
}

type PlaceProbeScreenPoint = {
  x: number
  y: number
}

type PlaceProbeProject = (point: PlaceProbePoint) => PlaceProbeScreenPoint | null

type PlaceProbeSelectionContext = {
  bounds: PlaceProbeBounds | null
  project: PlaceProbeProject | null
}

export type PlaceProbeValueLabel = {
  id: string
  name: string
  lon: number
  lat: number
  sortKey: number
  probeText: string
}

export type PlaceProbeLabelSnapshot = Map<string, PlaceProbeValueLabel>

const PLACE_PROBE_LAYER_MIN_ZOOM = 3.5
const PLACE_PROBE_COLLISION_PADDING_PX = 0

const PLACE_PROBE_LAYER: LayerSpecification = {
  id: placeProbeLayerIds.layer,
  type: 'symbol',
  source: placeProbeLayerIds.source,
  minzoom: PLACE_PROBE_LAYER_MIN_ZOOM,
  layout: {
    'symbol-sort-key': ['get', 'sortKey'],
    'text-anchor': 'bottom',
    'text-field': ['concat', ['get', 'name'], '\n', ['get', 'probeText']],
    'text-font': ['Star4LargeRegular'],
    'text-letter-spacing': 0.04,
    'text-line-height': 1.38,
    'text-max-width': 8,
    'text-offset': [0, -0.2],
    'text-overlap': 'never',
    'text-padding': PLACE_PROBE_COLLISION_PADDING_PX,
    'text-size': [
      'interpolate', ['exponential', 1.2], ['zoom'],
      3, 12,
      7, 14,
      10, 17.5,
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
  if (map.getLayer(placeProbeLayerIds.layer)) {
    map.removeLayer(placeProbeLayerIds.layer)
  }
  if (map.getSource(placeProbeLayerIds.source)) {
    map.removeSource(placeProbeLayerIds.source)
  }
}

function queryBasemapPlaceFeatures(map: MapLibreMap): GeoJSONFeature[] {
  return map.querySourceFeatures(basemapLayerIds.source, {
    sourceLayer: basemapLayerIds.placeSourceLayer,
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
      sortKey: label.sortKey,
      probeText: label.probeText,
    },
  }
}

export const mapPlaceProbeLayer = {
  ensure: ensurePlaceProbeLayer,
  remove: removePlaceProbeLayer,
  queryBasemapPlaces: queryBasemapPlaceFeatures,
  getBounds: getMapBounds,
  getSelectionContext: getPlaceProbeSelectionContext,
  setLabels: setPlaceProbeLabels,
  updateLabels: updatePlaceProbeLabels,
} as const
