import type {
  MapSelectedPlace,
  MapPlaceProject,
  MapPlaceScreenPoint,
  SelectMapPlacesOptions,
} from './types'

const DEFAULT_PLACE_PROBE_LIMIT = 45
const PLACE_PROBE_SPREAD_CELL_PX = 220
const PLACE_PROBE_MIN_SPACING_PX = 90
const PLACE_PROBE_SPREAD_SLOT_RATIO = 0.33

type SelectMapPlacesBySpreadOptions = Pick<
  SelectMapPlacesOptions,
  'limit' | 'cellSizePx' | 'minSpacingPx' | 'previousPlaces'
> & {
  project?: MapPlaceProject | null
}

type ProjectedMapPlace = MapSelectedPlace & {
  screenPoint: MapPlaceScreenPoint
}

type SelectionState = {
  places: ProjectedMapPlace[]
  placeIds: Set<string>
  occupiedCells: Set<string>
}

type SelectionPass = (state: SelectionState) => void

export function selectMapPlacesBySpread(
  candidates: MapSelectedPlace[],
  {
    limit = DEFAULT_PLACE_PROBE_LIMIT,
    project = null,
    cellSizePx = PLACE_PROBE_SPREAD_CELL_PX,
    minSpacingPx = PLACE_PROBE_MIN_SPACING_PX,
    previousPlaces = [],
  }: SelectMapPlacesBySpreadOptions,
): MapSelectedPlace[] {
  const normalizedLimit = normalizePlaceLimit(limit)
  if (normalizedLimit <= 0 || candidates.length === 0) return []
  if (candidates.length <= normalizedLimit) return assignSortKeys(candidates)

  if (project == null) return assignSortKeys(candidates.slice(0, normalizedLimit))

  const projectedCandidates = projectMapPlaces(candidates, project)
  if (projectedCandidates.length === 0) {
    return assignSortKeys(candidates.slice(0, normalizedLimit))
  }

  return assignSortKeys(selectProjectedMapPlaces(
    projectedCandidates,
    normalizedLimit,
    normalizeCellSize(cellSizePx),
    normalizeMinSpacing(minSpacingPx),
    previousPlaces,
  ))
}

function selectProjectedMapPlaces(
  candidates: ProjectedMapPlace[],
  limit: number,
  cellSizePx: number,
  minSpacingPx: number,
  previousPlaces: MapSelectedPlace[],
): MapSelectedPlace[] {
  const coreCount = getStableCorePlaceCount(limit, candidates.length)
  const state = createSelectionState(candidates.slice(0, coreCount), cellSizePx)
  if (state.places.length >= limit) return state.places

  for (const pass of createSelectionPasses({
    candidates,
    candidatesAfterCore: candidates.slice(coreCount),
    previousPlaces,
    limit,
    cellSizePx,
    minSpacingPx,
  })) {
    pass(state)
    if (state.places.length >= limit) return state.places
  }

  return state.places
}

function createSelectionPasses({
  candidates,
  candidatesAfterCore,
  previousPlaces,
  limit,
  cellSizePx,
  minSpacingPx,
}: {
  candidates: ProjectedMapPlace[]
  candidatesAfterCore: ProjectedMapPlace[]
  previousPlaces: MapSelectedPlace[]
  limit: number
  cellSizePx: number
  minSpacingPx: number
}): SelectionPass[] {
  const passes: SelectionPass[] = [
    createPreviousPlacesPass(candidates, previousPlaces, limit, cellSizePx),
    createEmptyCellPass(candidatesAfterCore, limit, cellSizePx, minSpacingPx),
  ]

  if (minSpacingPx > 1) {
    passes.push(createEmptyCellPass(
      candidatesAfterCore,
      limit,
      cellSizePx,
      minSpacingPx * 0.65,
    ))
  }

  passes.push(createSpacedPlacesPass(candidates, limit, minSpacingPx))

  if (minSpacingPx > 1) {
    passes.push(createSpacedPlacesPass(candidates, limit, minSpacingPx * 0.65))
  }

  passes.push(createRankFallbackPass(candidates, limit))
  return passes
}

function createSelectionState(
  initialPlaces: ProjectedMapPlace[],
  cellSizePx: number,
): SelectionState {
  return {
    places: [...initialPlaces],
    placeIds: new Set(initialPlaces.map((place) => place.id)),
    occupiedCells: new Set(
      initialPlaces.map((place) => getScreenCellKey(place.screenPoint, cellSizePx))
    ),
  }
}

function createPreviousPlacesPass(
  candidates: ProjectedMapPlace[],
  previousPlaces: MapSelectedPlace[],
  limit: number,
  cellSizePx: number,
): SelectionPass {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]))

  return (state) => {
    for (const previousPlace of previousPlaces) {
      if (state.places.length >= limit) return

      const candidate = candidatesById.get(previousPlace.id)
      if (candidate == null) continue
      addSelectedPlace(state, candidate, cellSizePx)
    }
  }
}

function createEmptyCellPass(
  candidates: ProjectedMapPlace[],
  limit: number,
  cellSizePx: number,
  minSpacingPx: number,
): SelectionPass {
  return (state) => {
    for (const candidate of candidates) {
      if (state.places.length >= limit) return
      if (state.placeIds.has(candidate.id)) continue

      const cellKey = getScreenCellKey(candidate.screenPoint, cellSizePx)
      if (state.occupiedCells.has(cellKey)) continue
      if (isTooCloseToSelectedPlace(candidate, state.places, minSpacingPx)) continue

      addSelectedPlace(state, candidate, cellSizePx)
    }
  }
}

function createSpacedPlacesPass(
  candidates: ProjectedMapPlace[],
  limit: number,
  minSpacingPx: number,
): SelectionPass {
  return (state) => {
    for (const candidate of candidates) {
      if (state.places.length >= limit) return
      if (state.placeIds.has(candidate.id)) continue
      if (isTooCloseToSelectedPlace(candidate, state.places, minSpacingPx)) continue

      addSelectedPlace(state, candidate)
    }
  }
}

function createRankFallbackPass(
  candidates: ProjectedMapPlace[],
  limit: number,
): SelectionPass {
  return (state) => {
    for (const candidate of candidates) {
      if (state.places.length >= limit) return
      addSelectedPlace(state, candidate)
    }
  }
}

function addSelectedPlace(
  state: SelectionState,
  place: ProjectedMapPlace,
  cellSizePx?: number,
): void {
  if (state.placeIds.has(place.id)) return

  state.places.push(place)
  state.placeIds.add(place.id)
  if (cellSizePx != null) {
    state.occupiedCells.add(getScreenCellKey(place.screenPoint, cellSizePx))
  }
}

function projectMapPlaces(
  candidates: MapSelectedPlace[],
  project: MapPlaceProject,
): ProjectedMapPlace[] {
  const projectedCandidates: ProjectedMapPlace[] = []

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

function isTooCloseToSelectedPlace(
  candidate: ProjectedMapPlace,
  selected: ProjectedMapPlace[],
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

function getScreenCellKey(point: MapPlaceScreenPoint, cellSizePx: number): string {
  return `${Math.floor(point.x / cellSizePx)}:${Math.floor(point.y / cellSizePx)}`
}

function getStableCorePlaceCount(limit: number, candidateCount: number): number {
  if (limit <= 1) return Math.min(limit, candidateCount)

  const spreadSlots = Math.max(1, Math.floor(limit * PLACE_PROBE_SPREAD_SLOT_RATIO))
  return Math.min(candidateCount, Math.max(1, limit - spreadSlots))
}

function assignSortKeys(places: MapSelectedPlace[]): MapSelectedPlace[] {
  return places.map((place, index) => ({
    id: place.id,
    name: place.name,
    localName: place.localName,
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

function isFiniteScreenPoint(point: MapPlaceScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}
