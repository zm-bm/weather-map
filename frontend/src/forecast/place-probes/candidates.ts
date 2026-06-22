import type { GeoJSONFeature } from 'maplibre-gl'

import type {
  PlaceProbe,
  PlaceProbeBounds,
  PlaceProbePoint,
} from './places'
import { PLACE_PROBE_POLICY } from './policy'

const LOCAL_NAME_PROPERTY_NAMES = ['name', 'name2', 'name3'] as const
const NON_LATIN_SCRIPT_PATTERN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

type CreatePlaceProbeCandidatesOptions = {
  zoom?: number
  bounds?: PlaceProbeBounds | null
}

type RankedPlaceProbe = PlaceProbe & {
  population: number | null
  populationRank: number | null
}

export type PlaceProbeZoomTier = 0 | 1 | 2 | 3

export function getPlaceProbeZoomTier(
  zoom: number = PLACE_PROBE_POLICY.zoom.min,
): PlaceProbeZoomTier {
  if (zoom <= PLACE_PROBE_POLICY.zoom.min) return 0
  if (zoom < PLACE_PROBE_POLICY.zoom.mid) return 1
  if (zoom < PLACE_PROBE_POLICY.zoom.local) return 2
  return 3
}

export function getRelaxedPlaceProbeBackfillZoom(
  zoom: number = PLACE_PROBE_POLICY.zoom.min,
): number | null {
  switch (getPlaceProbeZoomTier(zoom)) {
    case 1:
      return PLACE_PROBE_POLICY.zoom.mid
    case 2:
      return PLACE_PROBE_POLICY.zoom.local
    default:
      return null
  }
}

export function createPlaceProbeCandidates(
  features: GeoJSONFeature[],
  {
    zoom = PLACE_PROBE_POLICY.zoom.min,
    bounds = null,
  }: CreatePlaceProbeCandidatesOptions = {},
): PlaceProbe[] {
  const candidates: RankedPlaceProbe[] = []

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
      id: createPlaceProbeId(name, point),
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

  candidates.sort(comparePlaceProbes)
  return dedupePlaceProbes(candidates)
}

function dedupePlaceProbes(candidates: RankedPlaceProbe[]): PlaceProbe[] {
  const seenPlaceIds = new Set<string>()
  const uniquePlaces: PlaceProbe[] = []

  for (const candidate of candidates) {
    if (seenPlaceIds.has(candidate.id)) continue
    seenPlaceIds.add(candidate.id)
    uniquePlaces.push({
      id: candidate.id,
      name: candidate.name,
      localName: candidate.localName,
      lon: candidate.lon,
      lat: candidate.lat,
      tier: candidate.tier,
      sortKey: candidate.sortKey,
    })
  }

  return uniquePlaces
}

function getPlacePoint(feature: GeoJSONFeature): PlaceProbePoint | null {
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
  const zoomTier = getPlaceProbeZoomTier(zoom)
  if (zoomTier === 0 || !isLocality(feature)) return null
  if (feature.properties?.capital === 'yes') return 0

  if (population != null) {
    if (population >= PLACE_PROBE_POLICY.population.major) return 1
    if (population >= PLACE_PROBE_POLICY.population.mid) return zoomTier >= 2 ? 2 : null
    return zoomTier >= 3 ? 3 : null
  }

  if (populationRank != null) {
    if (populationRank <= 4) return 1
    if (populationRank === 5) return zoomTier >= 2 ? 2 : null
    return zoomTier >= 3 ? 3 : null
  }

  return null
}

function comparePlaceProbes(left: RankedPlaceProbe, right: RankedPlaceProbe): number {
  if (left.tier !== right.tier) return left.tier - right.tier

  if (left.population != null || right.population != null) {
    return (right.population ?? -1) - (left.population ?? -1)
  }

  if (left.populationRank != null || right.populationRank != null) {
    return (left.populationRank ?? Number.MAX_SAFE_INTEGER) - (right.populationRank ?? Number.MAX_SAFE_INTEGER)
  }

  return left.name.localeCompare(right.name)
}

function createPlaceProbeId(name: string, point: PlaceProbePoint): string {
  return `${name}:${point.lon.toFixed(4)}:${point.lat.toFixed(4)}`
}
