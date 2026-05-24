import type { GeoJSONFeature } from 'maplibre-gl'

import { createPlaceProbeCandidates } from './candidates'
import { selectPlaceProbesBySpread } from './selection'

export type PlaceProbePoint = {
  lon: number
  lat: number
}

export type PlaceProbeScreenPoint = {
  x: number
  y: number
}

export type PlaceProbeProject = (
  point: PlaceProbePoint
) => PlaceProbeScreenPoint | null

export type PlaceProbe = PlaceProbePoint & {
  id: string
  name: string
  localName: string | null
  tier: number
  sortKey: number
  population: number | null
  populationRank: number | null
}

export type PlaceProbeBounds = {
  contains: (lngLat: [number, number]) => boolean
}

export type SelectPlaceProbesOptions = {
  zoom?: number
  limit?: number
  bounds?: PlaceProbeBounds | null
  project?: PlaceProbeProject | null
  cellSizePx?: number
  minSpacingPx?: number
  previousPlaces?: PlaceProbe[]
}

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
