import type { GeoJSONFeature } from 'maplibre-gl'

import { createMapPlaceCandidates } from './candidates'
import { selectMapPlacesBySpread } from './selection'
import type {
  MapSelectedPlace,
  SelectMapPlacesOptions,
} from './types'

export type {
  MapSelectedPlace,
  MapPlaceBounds,
  MapPlacePoint,
  MapPlaceProject,
  MapPlaceScreenPoint,
  SelectMapPlacesOptions,
} from './types'

function selectVisibleMapPlaces(
  features: GeoJSONFeature[],
  options: SelectMapPlacesOptions = {},
): MapSelectedPlace[] {
  const { zoom, bounds = null } = options
  const candidates = createMapPlaceCandidates(features, {
    zoom,
    bounds,
  })

  return selectMapPlacesBySpread(candidates, options)
}

function getMapPlaceKey(places: MapSelectedPlace[]): string {
  return places.map((place) => place.id).join('|')
}

export const mapPlaceSelection = {
  selectVisible: selectVisibleMapPlaces,
  getKey: getMapPlaceKey,
} as const
