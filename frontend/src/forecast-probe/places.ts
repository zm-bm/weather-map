import type { GeoJSONFeature } from 'maplibre-gl'

import type {
  ScalarFrameData,
  ScalarFrameWindowData,
} from '../forecast-frame/scalar'
import type { ForecastProbeValueDisplay } from './display'
import {
  createScalarProbeSampler,
  sampleScalarFrameWindowWithSampler,
  type ScalarProbeSampler,
} from './scalar'

const DEFAULT_PLACE_PROBE_LIMIT = 40
const PLACE_PROBE_ZOOM_THRESHOLD = 3.5
const MAJOR_PLACE_POPULATION = 1_000_000
const MID_PLACE_POPULATION = 250_000
const PLACE_PROBE_SPREAD_CELL_PX = 220
const PLACE_PROBE_MIN_SPACING_PX = 90
const PLACE_PROBE_SPREAD_SLOT_RATIO = 0.5

export type ForecastProbePoint = {
  lon: number
  lat: number
}

export type ForecastProbeScreenPoint = {
  x: number
  y: number
}

export type ForecastProbeProject = (
  point: ForecastProbePoint
) => ForecastProbeScreenPoint | null

export type ForecastProbePlace = ForecastProbePoint & {
  id: string
  name: string
  tier: number
  sortKey: number
  population: number | null
  populationRank: number | null
}

export type ForecastProbePlaceScalarSamplers = {
  frameGridKey: string | null
  placeKey: string
  samplers: Array<ScalarProbeSampler | null>
}

export type ForecastProbePlaceValueLabel = ForecastProbePoint & {
  id: string
  name: string
  sortKey: number
  probeText: string
}

export type ForecastProbePlaceBounds = {
  contains: (lngLat: [number, number]) => boolean
}

export type SelectForecastProbePlacesOptions = {
  zoom?: number
  limit?: number
  bounds?: ForecastProbePlaceBounds | null
  project?: ForecastProbeProject | null
  cellSizePx?: number
  minSpacingPx?: number
}

type ForecastProbeValueFormatter = (
  rawProbeValue: number | null,
  loading?: boolean
) => Pick<ForecastProbeValueDisplay, 'text'>

function selectVisibleForecastProbePlaces(
  features: GeoJSONFeature[],
  {
    zoom = PLACE_PROBE_ZOOM_THRESHOLD,
    limit = DEFAULT_PLACE_PROBE_LIMIT,
    bounds = null,
    project = null,
    cellSizePx = PLACE_PROBE_SPREAD_CELL_PX,
    minSpacingPx = PLACE_PROBE_MIN_SPACING_PX,
  }: SelectForecastProbePlacesOptions = {},
): ForecastProbePlace[] {
  const candidates: ForecastProbePlace[] = []

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
      lon: point.lon,
      lat: point.lat,
      tier,
      sortKey: 0,
      population,
      populationRank,
    })
  }

  candidates.sort(compareForecastProbePlaces)

  return assignSortKeys(selectForecastProbePlacesBySpread(
    dedupeForecastProbePlaces(candidates),
    {
      limit,
      project,
      cellSizePx,
      minSpacingPx,
    },
  ))
}

function dedupeForecastProbePlaces(candidates: ForecastProbePlace[]): ForecastProbePlace[] {
  const seenPlaceIds = new Set<string>()
  const uniquePlaces: ForecastProbePlace[] = []

  for (const candidate of candidates) {
    if (seenPlaceIds.has(candidate.id)) continue
    seenPlaceIds.add(candidate.id)
    uniquePlaces.push(candidate)
  }

  return uniquePlaces
}

function selectForecastProbePlacesBySpread(
  candidates: ForecastProbePlace[],
  {
    limit,
    project,
    cellSizePx,
    minSpacingPx,
  }: Required<Pick<SelectForecastProbePlacesOptions, 'limit' | 'cellSizePx' | 'minSpacingPx'>> & {
    project: ForecastProbeProject | null
  },
): ForecastProbePlace[] {
  const normalizedLimit = normalizePlaceLimit(limit)
  if (normalizedLimit <= 0 || candidates.length === 0) return []
  if (candidates.length <= normalizedLimit) return candidates

  if (project == null) return candidates.slice(0, normalizedLimit)

  const projectedCandidates = projectForecastProbePlaces(candidates, project)
  if (projectedCandidates.length === 0) return candidates.slice(0, normalizedLimit)

  return selectProjectedForecastProbePlaces(
    projectedCandidates,
    normalizedLimit,
    normalizeCellSize(cellSizePx),
    normalizeMinSpacing(minSpacingPx),
  )
}

type ProjectedForecastProbePlace = ForecastProbePlace & {
  screenPoint: ForecastProbeScreenPoint
}

function projectForecastProbePlaces(
  candidates: ForecastProbePlace[],
  project: ForecastProbeProject,
): ProjectedForecastProbePlace[] {
  const projectedCandidates: ProjectedForecastProbePlace[] = []

  for (const candidate of candidates) {
    const screenPoint = project(candidate)
    if (screenPoint == null || !isFiniteScreenPoint(screenPoint)) continue
    projectedCandidates.push({
      ...candidate,
      screenPoint,
    })
  }

  return projectedCandidates
}

function selectProjectedForecastProbePlaces(
  candidates: ProjectedForecastProbePlace[],
  limit: number,
  cellSizePx: number,
  minSpacingPx: number,
): ForecastProbePlace[] {
  const stableCoreCount = getStableCorePlaceCount(limit, candidates.length)
  const selected = candidates.slice(0, stableCoreCount)
  const selectedPlaceIds = new Set(selected.map((place) => place.id))
  const occupiedCells = new Set(
    selected.map((place) => getScreenCellKey(place.screenPoint, cellSizePx))
  )

  if (selected.length >= limit) return selected

  addEmptyCellForecastProbePlaces(
    candidates.slice(stableCoreCount),
    selected,
    selectedPlaceIds,
    occupiedCells,
    limit,
    cellSizePx,
    minSpacingPx,
  )
  if (selected.length < limit && minSpacingPx > 1) {
    addEmptyCellForecastProbePlaces(
      candidates.slice(stableCoreCount),
      selected,
      selectedPlaceIds,
      occupiedCells,
      limit,
      cellSizePx,
      minSpacingPx * 0.65,
    )
  }
  addSpacedForecastProbePlaces(candidates, selected, selectedPlaceIds, limit, minSpacingPx)
  if (selected.length < limit && minSpacingPx > 1) {
    addSpacedForecastProbePlaces(candidates, selected, selectedPlaceIds, limit, minSpacingPx * 0.65)
  }
  addForecastProbePlacesByRank(candidates, selected, selectedPlaceIds, limit)

  return selected
}

function addEmptyCellForecastProbePlaces(
  candidates: ProjectedForecastProbePlace[],
  selected: ProjectedForecastProbePlace[],
  selectedPlaceIds: Set<string>,
  occupiedCells: Set<string>,
  limit: number,
  cellSizePx: number,
  minSpacingPx: number,
): void {
  if (selected.length >= limit) return

  for (const candidate of candidates) {
    if (selectedPlaceIds.has(candidate.id)) continue

    const cellKey = getScreenCellKey(candidate.screenPoint, cellSizePx)
    if (occupiedCells.has(cellKey)) continue
    if (isTooCloseToSelectedPlace(candidate, selected, minSpacingPx)) continue

    selected.push(candidate)
    selectedPlaceIds.add(candidate.id)
    occupiedCells.add(cellKey)
    if (selected.length >= limit) return
  }
}

function addSpacedForecastProbePlaces(
  candidates: ProjectedForecastProbePlace[],
  selected: ProjectedForecastProbePlace[],
  selectedPlaceIds: Set<string>,
  limit: number,
  minSpacingPx: number,
): void {
  if (selected.length >= limit) return

  for (const candidate of candidates) {
    if (selectedPlaceIds.has(candidate.id)) continue
    if (isTooCloseToSelectedPlace(candidate, selected, minSpacingPx)) continue

    selected.push(candidate)
    selectedPlaceIds.add(candidate.id)
    if (selected.length >= limit) return
  }
}

function addForecastProbePlacesByRank(
  candidates: ProjectedForecastProbePlace[],
  selected: ProjectedForecastProbePlace[],
  selectedPlaceIds: Set<string>,
  limit: number,
): void {
  if (selected.length >= limit) return

  for (const candidate of candidates) {
    if (selectedPlaceIds.has(candidate.id)) continue

    selected.push(candidate)
    selectedPlaceIds.add(candidate.id)
    if (selected.length >= limit) return
  }
}

function isTooCloseToSelectedPlace(
  candidate: ProjectedForecastProbePlace,
  selected: ProjectedForecastProbePlace[],
  minSpacingPx: number,
): boolean {
  if (minSpacingPx <= 0) return false

  const minDistanceSquared = minSpacingPx * minSpacingPx
  return selected.some((place) => {
    const dx = candidate.screenPoint.x - place.screenPoint.x
    const dy = candidate.screenPoint.y - place.screenPoint.y
    return dx * dx + dy * dy < minDistanceSquared
  })
}

function getScreenCellKey(point: ForecastProbeScreenPoint, cellSizePx: number): string {
  return `${Math.floor(point.x / cellSizePx)}:${Math.floor(point.y / cellSizePx)}`
}

function getStableCorePlaceCount(limit: number, candidateCount: number): number {
  if (limit <= 1) return Math.min(limit, candidateCount)

  const spreadSlots = Math.max(1, Math.ceil(limit * PLACE_PROBE_SPREAD_SLOT_RATIO))
  return Math.min(candidateCount, Math.max(1, limit - spreadSlots))
}

function assignSortKeys(places: ForecastProbePlace[]): ForecastProbePlace[] {
  return places.map((place, index) => ({
    id: place.id,
    name: place.name,
    lon: place.lon,
    lat: place.lat,
    tier: place.tier,
    sortKey: index,
    population: place.population,
    populationRank: place.populationRank,
  }))
}

function normalizePlaceLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_PLACE_PROBE_LIMIT
  return Math.max(0, Math.floor(limit))
}

function normalizeCellSize(cellSizePx: number): number {
  if (!Number.isFinite(cellSizePx) || cellSizePx <= 0) return PLACE_PROBE_SPREAD_CELL_PX
  return cellSizePx
}

function normalizeMinSpacing(minSpacingPx: number): number {
  if (!Number.isFinite(minSpacingPx) || minSpacingPx < 0) return PLACE_PROBE_MIN_SPACING_PX
  return minSpacingPx
}

function isFiniteScreenPoint(point: ForecastProbeScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function getForecastProbePlaceKey(places: ForecastProbePlace[]): string {
  return places.map((place) => place.id).join('|')
}

function refreshScalarForecastProbePlaceSamplers(
  frame: ScalarFrameWindowData | null,
  places: ForecastProbePlace[],
  previousSamplers?: ForecastProbePlaceScalarSamplers,
  force = false,
): ForecastProbePlaceScalarSamplers {
  const placeKey = getForecastProbePlaceKey(places)

  if (frame == null) {
    return {
      frameGridKey: null,
      placeKey,
      samplers: [],
    }
  }

  const frameGridKey = getScalarFrameGridKey(frame.lower)
  if (
    !force &&
    previousSamplers?.frameGridKey === frameGridKey &&
    previousSamplers.placeKey === placeKey
  ) {
    return previousSamplers
  }

  return {
    frameGridKey,
    placeKey,
    samplers: places.map((place) => createScalarProbeSampler(frame.lower, place)),
  }
}

function createScalarForecastProbePlaceValueLabels(
  places: ForecastProbePlace[],
  frame: ScalarFrameWindowData | null,
  samplerState: ForecastProbePlaceScalarSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): ForecastProbePlaceValueLabel[] {
  return places.map((place, index) => ({
    id: place.id,
    name: place.name,
    lon: place.lon,
    lat: place.lat,
    sortKey: place.sortKey,
    probeText: getScalarForecastProbePlaceText(index, frame, samplerState, formatProbeValue),
  }))
}

function getScalarForecastProbePlaceText(
  placeIndex: number,
  frame: ScalarFrameWindowData | null,
  samplerState: ForecastProbePlaceScalarSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): string {
  const sampler = samplerState.samplers[placeIndex]
  const rawValue = frame != null && sampler != null
    ? sampleScalarFrameWindowWithSampler(frame, sampler)
    : null

  return formatProbeValue(rawValue, frame == null).text
}

function getScalarFrameGridKey(frame: ScalarFrameData): string {
  const { grid } = frame
  return [
    grid.nx,
    grid.ny,
    grid.lon0,
    grid.lat0,
    grid.dx,
    grid.dy,
    grid.x_wrap,
    grid.y_mode,
  ].join(':')
}

function getPlacePoint(feature: GeoJSONFeature): ForecastProbePoint | null {
  if (feature.geometry.type !== 'Point') return null

  const [lon, lat] = feature.geometry.coordinates
  return typeof lon === 'number' && typeof lat === 'number'
    ? { lon, lat }
    : null
}

function getPlaceName(feature: GeoJSONFeature): string | null {
  const name = feature.properties?.['name:en']
    ?? feature.properties?.name
    ?? feature.properties?.name2
    ?? feature.properties?.name3
    ?? feature.id

  if (typeof name === 'number' && Number.isFinite(name)) return String(name)
  return typeof name === 'string' && name.length > 0 ? name : null
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

function compareForecastProbePlaces(left: ForecastProbePlace, right: ForecastProbePlace): number {
  if (left.tier !== right.tier) return left.tier - right.tier

  if (left.population != null || right.population != null) {
    return (right.population ?? -1) - (left.population ?? -1)
  }

  if (left.populationRank != null || right.populationRank != null) {
    return (left.populationRank ?? Number.MAX_SAFE_INTEGER) - (right.populationRank ?? Number.MAX_SAFE_INTEGER)
  }

  return left.name.localeCompare(right.name)
}

function createPlaceProbeId(name: string, point: ForecastProbePoint): string {
  return `${name}:${point.lon.toFixed(4)}:${point.lat.toFixed(4)}`
}

export const forecastProbePlaces = {
  selectVisible: selectVisibleForecastProbePlaces,
  getKey: getForecastProbePlaceKey,
  refreshScalarSamplers: refreshScalarForecastProbePlaceSamplers,
  createScalarValueLabels: createScalarForecastProbePlaceValueLabels,
} as const
