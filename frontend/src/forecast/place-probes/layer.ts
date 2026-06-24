import type {
  GeoJSONFeature,
  GeoJSONSource,
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
  PlaceProbeViewportSize,
} from './places'
import { PLACE_PROBE_POLICY } from './policy'

type PlaceProbeFeatureProperties = {
  labelText: string
  sortKey: number
}

type PlaceProbeFeature = Feature<Point, PlaceProbeFeatureProperties>
type PlaceProbeFeatureCollection = FeatureCollection<Point, PlaceProbeFeatureProperties>

export type PlaceProbeValueLabel = {
  id: string
  lon: number
  lat: number
  sortKey: number
  labelText: string
}

const FORECAST_PLACE_PROBE_SOURCE_ID = 'forecast-place-probes' as const
const FORECAST_PLACE_PROBE_LAYER_ID = 'forecast-place-probe-labels' as const

export const placeProbeLayerIds = {
  source: FORECAST_PLACE_PROBE_SOURCE_ID,
  layer: FORECAST_PLACE_PROBE_LAYER_ID,
} as const

const PLACE_LABEL_FONT_STACKS = ['Arial Bold', 'Noto Sans Bold', 'sans-serif'] as const

const PLACE_PROBE_LAYER: LayerSpecification = {
  id: placeProbeLayerIds.layer,
  type: 'symbol',
  source: placeProbeLayerIds.source,
  minzoom: PLACE_PROBE_POLICY.zoom.min,
  layout: {
    'symbol-sort-key': ['get', 'sortKey'],
    'text-field': ['get', 'labelText'],
    'text-font': [...PLACE_LABEL_FONT_STACKS],
    'text-justify': 'auto',
    'text-letter-spacing': 0,
    'text-line-height': 1.05,
    'text-max-width': 10,
    'text-overlap': 'never',
    'text-padding': 1,
    'text-radial-offset': 0.5,
    'text-size': [
      'interpolate', ['exponential', 1.2], ['zoom'],
      3, 12,
      7, 13.5,
      10, 16.5,
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
      'rgba(244, 248, 252, 0.94)',
    ],
    'text-halo-blur': 0.08,
    'text-halo-color': [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      'rgba(5, 8, 15, 0.96)',
      'rgba(11, 17, 30, 0.74)',
    ],
    'text-halo-width': [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      1.55,
      1.05,
    ],
  },
}

export function ensurePlaceProbeLayer(map: MapLibreMap): void {
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

export function removePlaceProbeLayer(map: MapLibreMap): void {
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

export function queryBasemapPlaceFeatures(map: MapLibreMap): GeoJSONFeature[] {
  return map.querySourceFeatures(BASEMAP_SOURCE_ID, {
    sourceLayer: BASEMAP_SOURCE_LAYER_IDS.places,
  })
}

export function getPlaceProbeBounds(map: MapLibreMap): PlaceProbeBounds | null {
  const getBounds = (map as MapLibreMap & { getBounds?: () => PlaceProbeBounds }).getBounds
  return getBounds?.call(map) ?? null
}

export function getPaddedPlaceProbeBounds(map: MapLibreMap): PlaceProbeBounds | null {
  return padPlaceProbeBounds(getPlaceProbeBounds(map))
}

export function getPlaceProbeViewportSize(map: MapLibreMap): PlaceProbeViewportSize | null {
  const canvas = (map as MapLibreMap & {
    getCanvas?: () => { clientWidth?: number; clientHeight?: number }
  }).getCanvas?.()
  const width = canvas?.clientWidth
  const height = canvas?.clientHeight
  return typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
    ? { width, height }
    : null
}

function padPlaceProbeBounds(bounds: PlaceProbeBounds | null): PlaceProbeBounds | null {
  if (bounds == null) return null

  const west = bounds.getWest?.()
  const east = bounds.getEast?.()
  const south = bounds.getSouth?.()
  const north = bounds.getNorth?.()
  if (
    !isFiniteNumber(west) ||
    !isFiniteNumber(east) ||
    !isFiniteNumber(south) ||
    !isFiniteNumber(north) ||
    east <= west ||
    north <= south
  ) {
    return bounds
  }

  const lonPadding = (east - west) * PLACE_PROBE_POLICY.bounds.paddingRatio
  const latPadding = (north - south) * PLACE_PROBE_POLICY.bounds.paddingRatio
  const padded = {
    west: west - lonPadding,
    east: east + lonPadding,
    south: Math.max(-90, south - latPadding),
    north: Math.min(90, north + latPadding),
  }

  return {
    contains: ([lon, lat]) => (
      lon >= padded.west &&
      lon <= padded.east &&
      lat >= padded.south &&
      lat <= padded.north
    ),
    getWest: () => padded.west,
    getEast: () => padded.east,
    getSouth: () => padded.south,
    getNorth: () => padded.north,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function setPlaceProbeLabels(
  map: MapLibreMap,
  labels: PlaceProbeValueLabel[],
): void {
  const source = getPlaceProbeSource(map)
  if (source == null) return

  source.setData(buildPlaceProbeCollection(labels))
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

function buildPlaceProbeCollection(labels: PlaceProbeValueLabel[]): PlaceProbeFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: labels.map(buildPlaceProbeFeature),
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
      labelText: label.labelText,
      sortKey: label.sortKey,
    },
  }
}
