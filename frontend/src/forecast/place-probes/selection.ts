import type {
  PlaceProbe,
  PlaceProbeBounds,
  PlaceProbeViewportSize,
} from './places'
import { PLACE_PROBE_POLICY } from './policy'

type SpreadBounds = {
  west: number
  east: number
  south: number
  north: number
}

export function selectSpreadPlaceProbes(
  candidates: PlaceProbe[],
  options: {
    gridBounds?: PlaceProbeBounds | null
    relaxedCandidates?: PlaceProbe[]
    viewportSize?: PlaceProbeViewportSize | null
    previousPlaces?: PlaceProbe[]
  } = {},
): PlaceProbe[] {
  const viewportSize = validViewportSize(options.viewportSize)
  const gridBounds = validSpreadBounds(options.gridBounds)
  if (viewportSize == null || gridBounds == null) {
    return assignSortKeys(candidates.slice(0, PLACE_PROBE_POLICY.labels.defaultLimit))
  }

  const limit = labelLimitForViewport(viewportSize)
  return assignSortKeys(selectByGridSpread(
    candidates,
    options.relaxedCandidates ?? [],
    gridCellSizeForBounds(gridBounds, gridForViewport(viewportSize, limit)),
    limit,
    options.previousPlaces ?? [],
  ))
}

function assignSortKeys(places: PlaceProbe[]): PlaceProbe[] {
  return places.map((place, index) => ({
    ...place,
    sortKey: index,
  }))
}

function selectByGridSpread(
  candidates: PlaceProbe[],
  relaxedCandidates: PlaceProbe[],
  cellSize: { width: number; height: number },
  limit: number,
  previousPlaces: PlaceProbe[],
): PlaceProbe[] {
  const selected: PlaceProbe[] = []
  const selectedIds = new Set<string>()
  const filledCells = new Set<string>()
  const candidatesById = placesById(candidates)
  const relaxedCandidatesById = placesById(relaxedCandidates)
  const addPlaceInEmptyCell = (place: PlaceProbe) => {
    if (selectedIds.has(place.id)) return

    const cellKey = cellKeyForPlace(place, cellSize)
    if (cellKey == null || filledCells.has(cellKey)) return

    selected.push(place)
    selectedIds.add(place.id)
    filledCells.add(cellKey)
  }
  const addPlacesInEmptyCells = (places: PlaceProbe[]) => {
    for (const place of places) {
      if (selected.length >= limit) return
      addPlaceInEmptyCell(place)
    }
  }
  const addRankFallbackPlaces = (places: PlaceProbe[]) => {
    for (const place of places) {
      if (selected.length >= limit) return
      if (selectedIds.has(place.id)) continue
      selected.push(place)
      selectedIds.add(place.id)
    }
  }

  addPlacesInEmptyCells(previousPlaces.flatMap((place) => candidatesById.get(place.id) ?? []))
  addPlacesInEmptyCells(candidates)
  addPlacesInEmptyCells(previousPlaces.flatMap((place) => relaxedCandidatesById.get(place.id) ?? []))
  addPlacesInEmptyCells(relaxedCandidates)
  addRankFallbackPlaces(candidates)

  return selected
}

function placesById(places: readonly PlaceProbe[]): Map<string, PlaceProbe> {
  return new Map(places.map((place) => [place.id, place]))
}

function labelLimitForViewport({ width, height }: PlaceProbeViewportSize): number {
  return clamp(
    Math.round((width * height) / PLACE_PROBE_POLICY.labels.areaPx),
    PLACE_PROBE_POLICY.labels.defaultLimit,
    PLACE_PROBE_POLICY.labels.maxLimit,
  )
}

function gridForViewport(
  { width, height }: PlaceProbeViewportSize,
  limit: number,
): { columns: number; rows: number } {
  const aspectRatio = width / height
  const columns = clamp(
    Math.round(Math.sqrt(limit * aspectRatio)),
    PLACE_PROBE_POLICY.grid.minColumns,
    PLACE_PROBE_POLICY.grid.maxColumns,
  )
  return {
    columns,
    rows: clamp(
      Math.ceil(limit / columns),
      PLACE_PROBE_POLICY.grid.minRows,
      PLACE_PROBE_POLICY.grid.maxRows,
    ),
  }
}

function gridCellSizeForBounds(
  bounds: SpreadBounds,
  { columns, rows }: { columns: number; rows: number },
): { width: number; height: number } {
  return {
    width: (bounds.east - bounds.west) / columns,
    height: (bounds.north - bounds.south) / rows,
  }
}

function cellKeyForPlace(
  place: PlaceProbe,
  { width, height }: { width: number; height: number },
): string | null {
  if (width <= 0 || height <= 0) return null
  const column = Math.floor((place.lon - PLACE_PROBE_POLICY.grid.worldWest) / width)
  const row = Math.floor((place.lat - PLACE_PROBE_POLICY.grid.worldSouth) / height)
  return `${column}:${row}`
}

function validViewportSize(size: PlaceProbeViewportSize | null | undefined): PlaceProbeViewportSize | null {
  if (
    size == null ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return null
  }

  return size
}

function validSpreadBounds(bounds: PlaceProbeBounds | null | undefined): SpreadBounds | null {
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
    return null
  }

  return { west, east, south, north }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
