import type { GeoJSONFeature } from 'maplibre-gl'

import type {
  MapSelectedPlace,
  MapPlaceBounds,
  MapPlacePoint,
} from './types'

const PLACE_PROBE_ZOOM_THRESHOLD = 3.5
const MAJOR_PLACE_POPULATION = 1_000_000
const MID_PLACE_POPULATION = 250_000
const LOCAL_NAME_PROPERTY_NAMES = ['name', 'name2', 'name3'] as const
const NON_LATIN_SCRIPT_PATTERN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

type CreateMapPlaceCandidatesOptions = {
  zoom?: number
  bounds?: MapPlaceBounds | null
}

export function createMapPlaceCandidates(
  features: GeoJSONFeature[],
  {
    zoom = PLACE_PROBE_ZOOM_THRESHOLD,
    bounds = null,
  }: CreateMapPlaceCandidatesOptions = {},
): MapSelectedPlace[] {
  const candidates: MapSelectedPlace[] = []

  for (const feature of features) {
    const name = getPlaceName(feature)
    const point = getPlacePoint(feature)
    if (name == null || point == null) continue
    if (bounds != null && !bounds.contains([point.lon, point.lat])) continue

    const population = getNumberProperty(feature, 'population')
    const populationRank = getNumberProperty(feature, 'population_rank')
    const tier = getPlaceTier(feature, zoom, population, populationRank)
    if (tier == null) continue

    candidates.push({
      id: createMapPlaceId(name, point),
      name,
      localName: getPlaceLocalName(feature, name),
      lon: point.lon,
      lat: point.lat,
      tier,
      sortKey: 0,
      population,
      populationRank,
    })
  }

  candidates.sort(compareMapPlaces)
  return dedupeMapPlaces(candidates)
}

function dedupeMapPlaces(candidates: MapSelectedPlace[]): MapSelectedPlace[] {
  const seenPlaceIds = new Set<string>()
  const uniquePlaces: MapSelectedPlace[] = []

  for (const candidate of candidates) {
    if (seenPlaceIds.has(candidate.id)) continue
    seenPlaceIds.add(candidate.id)
    uniquePlaces.push(candidate)
  }

  return uniquePlaces
}

function getPlacePoint(feature: GeoJSONFeature): MapPlacePoint | null {
  if (feature.geometry.type !== 'Point') return null

  const [lon, lat] = feature.geometry.coordinates
  return typeof lon === 'number' && typeof lat === 'number'
    ? { lon, lat }
    : null
}

function getPlaceName(feature: GeoJSONFeature): string | null {
  const name = getStringProperty(feature, 'name:en')
    ?? getStringProperty(feature, 'name')
    ?? getStringProperty(feature, 'name2')
    ?? getStringProperty(feature, 'name3')
    ?? getStringValue(feature.id)

  return name
}

function getPlaceLocalName(feature: GeoJSONFeature, displayName: string): string | null {
  for (const propertyName of LOCAL_NAME_PROPERTY_NAMES) {
    const localName = getStringProperty(feature, propertyName)
    if (
      localName != null &&
      localName !== displayName &&
      NON_LATIN_SCRIPT_PATTERN.test(localName)
    ) {
      return localName
    }
  }

  return null
}

function getStringProperty(feature: GeoJSONFeature, propertyName: string): string | null {
  return getStringValue(feature.properties?.[propertyName])
}

function getStringValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function getNumberProperty(feature: GeoJSONFeature, propertyName: string): number | null {
  const value = feature.properties?.[propertyName]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isLocality(feature: GeoJSONFeature): boolean {
  const kind = feature.properties?.kind
  return kind == null || kind === 'locality'
}

function getPlaceTier(
  feature: GeoJSONFeature,
  zoom: number,
  population: number | null,
  populationRank: number | null
): number | null {
  if (zoom <= PLACE_PROBE_ZOOM_THRESHOLD || !isLocality(feature)) return null
  if (feature.properties?.capital === 'yes') return 0

  if (population != null) {
    if (population >= MAJOR_PLACE_POPULATION) return 1
    if (population >= MID_PLACE_POPULATION) return 2
    return 3
  }

  if (populationRank != null) {
    if (populationRank <= 4) return 1
    if (populationRank === 5) return 2
    return 3
  }

  return null
}

function compareMapPlaces(left: MapSelectedPlace, right: MapSelectedPlace): number {
  if (left.tier !== right.tier) return left.tier - right.tier

  if (left.population != null || right.population != null) {
    return (right.population ?? -1) - (left.population ?? -1)
  }

  if (left.populationRank != null || right.populationRank != null) {
    return (left.populationRank ?? Number.MAX_SAFE_INTEGER) - (right.populationRank ?? Number.MAX_SAFE_INTEGER)
  }

  return left.name.localeCompare(right.name)
}

function createMapPlaceId(name: string, point: MapPlacePoint): string {
  return `${name}:${point.lon.toFixed(4)}:${point.lat.toFixed(4)}`
}
