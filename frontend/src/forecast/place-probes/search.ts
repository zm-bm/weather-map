import type { Map as MapLibreMap } from 'maplibre-gl'

import { queryBasemapPlaceFeatures } from './layer'
import { createPlaceProbeCandidates } from './candidates'
import {
  type PlaceProbe,
} from './places'

export type PlaceSearchResult = Pick<
  PlaceProbe,
  'id' | 'name' | 'localName' | 'lon' | 'lat'
>

const DEFAULT_PLACE_SEARCH_LIMIT = 6
const PLACE_SEARCH_CANDIDATE_LIMIT = 200
const PLACE_SEARCH_ZOOM = 6
const MIN_PLACE_SEARCH_LENGTH = 2

export function searchBasemapPlaces(
  map: MapLibreMap | null,
  query: string,
  limit = DEFAULT_PLACE_SEARCH_LIMIT,
): PlaceSearchResult[] {
  const normalizedQuery = normalizePlaceSearchText(query)
  if (map == null || normalizedQuery.length < MIN_PLACE_SEARCH_LENGTH) return []

  let candidates: PlaceProbe[]
  try {
    candidates = createPlaceProbeCandidates(
      queryBasemapPlaceFeatures(map),
      { zoom: PLACE_SEARCH_ZOOM },
    ).slice(0, PLACE_SEARCH_CANDIDATE_LIMIT)
  } catch {
    return []
  }

  return candidates
    .map((place, index) => ({
      place,
      index,
      rank: getPlaceSearchRank(place, normalizedQuery),
    }))
    .filter(({ rank }) => rank != null)
    .sort((left, right) => (
      left.rank! - right.rank! ||
      left.index - right.index
    ))
    .slice(0, normalizeSearchLimit(limit))
    .map(({ place }) => ({
      id: place.id,
      name: place.name,
      localName: place.localName,
      lon: place.lon,
      lat: place.lat,
    }))
}

function getPlaceSearchRank(place: PlaceProbe, query: string): number | null {
  const names = [
    normalizePlaceSearchText(place.name),
    normalizePlaceSearchText(place.localName ?? ''),
  ].filter(Boolean)

  if (names.some((name) => name === query)) return 0
  if (names.some((name) => name.startsWith(query))) return 1
  if (names.some((name) => name.includes(query))) return 2
  return null
}

function normalizePlaceSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

function normalizeSearchLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_PLACE_SEARCH_LIMIT
}
