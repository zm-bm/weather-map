import type { GeoJSONFeature } from 'maplibre-gl'

import {
  createPlaceProbeCandidates,
  getRelaxedPlaceProbeBackfillZoom,
} from './candidates'
import { selectSpreadPlaceProbes } from './selection'

export type PlaceProbePoint = {
  lon: number
  lat: number
}

export type PlaceProbe = PlaceProbePoint & {
  id: string
  name: string
  localName: string | null
  tier: number
  sortKey: number
}

export type PlaceProbeBounds = {
  contains: (lngLat: [number, number]) => boolean
  getWest?: () => number
  getEast?: () => number
  getSouth?: () => number
  getNorth?: () => number
}

export type PlaceProbeViewportSize = {
  width: number
  height: number
}

export type SelectPlaceProbesOptions = {
  zoom?: number
  bounds?: PlaceProbeBounds | null
  gridBounds?: PlaceProbeBounds | null
  viewportSize?: PlaceProbeViewportSize | null
  previousPlaces?: PlaceProbe[]
}

export function selectVisiblePlaceProbes(
  features: GeoJSONFeature[],
  options: SelectPlaceProbesOptions = {},
): PlaceProbe[] {
  const {
    zoom,
    bounds = null,
    gridBounds = bounds,
    viewportSize = null,
    previousPlaces = [],
  } = options
  const candidates = createPlaceProbeCandidates(features, {
    zoom,
    bounds,
  })
  const spreadBounds = gridBounds ?? bounds
  const relaxedBackfillZoom = viewportSize != null && spreadBounds != null
    ? getRelaxedPlaceProbeBackfillZoom(zoom)
    : null

  return selectSpreadPlaceProbes(candidates, {
    gridBounds: spreadBounds,
    relaxedCandidates: relaxedBackfillZoom == null
      ? []
      : createPlaceProbeCandidates(features, {
        zoom: relaxedBackfillZoom,
        bounds,
      }),
    viewportSize,
    previousPlaces,
  })
}

export function getPlaceProbeKey(places: PlaceProbe[]): string {
  return places.map((place) => place.id).join('|')
}
