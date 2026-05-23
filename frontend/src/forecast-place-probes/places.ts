import type { GeoJSONFeature } from 'maplibre-gl'

import { createPlaceProbeCandidates } from './candidates'
import { selectPlaceProbesBySpread } from './selection'
import type {
  PlaceProbe,
  SelectPlaceProbesOptions,
} from './types'

export type {
  PlaceProbe,
  PlaceProbeBounds,
  PlaceProbePoint,
  PlaceProbeProject,
  PlaceProbeScreenPoint,
  SelectPlaceProbesOptions,
} from './types'

export function selectVisiblePlaceProbes(
  features: GeoJSONFeature[],
  options: SelectPlaceProbesOptions = {},
): PlaceProbe[] {
  const { zoom, bounds = null } = options
  const candidates = createPlaceProbeCandidates(features, {
    zoom,
    bounds,
  })

  return selectPlaceProbesBySpread(candidates, options)
}

export function getPlaceProbeKey(places: PlaceProbe[]): string {
  return places.map((place) => place.id).join('|')
}
