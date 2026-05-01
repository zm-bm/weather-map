export type MapPlacePoint = {
  lon: number
  lat: number
}

export type MapPlaceScreenPoint = {
  x: number
  y: number
}

export type MapPlaceProject = (
  point: MapPlacePoint
) => MapPlaceScreenPoint | null

export type MapSelectedPlace = MapPlacePoint & {
  id: string
  name: string
  localName: string | null
  tier: number
  sortKey: number
  population: number | null
  populationRank: number | null
}

export type MapPlaceBounds = {
  contains: (lngLat: [number, number]) => boolean
}

export type SelectMapPlacesOptions = {
  zoom?: number
  limit?: number
  bounds?: MapPlaceBounds | null
  project?: MapPlaceProject | null
  cellSizePx?: number
  minSpacingPx?: number
  previousPlaces?: MapSelectedPlace[]
}
