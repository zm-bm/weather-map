export const BASEMAP_SOURCE_ID = 'basemap' as const

export const BASEMAP_SOURCE_LAYER_IDS = {
  water: 'water',
  roads: 'roads',
  boundaries: 'boundaries',
  places: 'places',
} as const

export const BASEMAP_LAYER_IDS = {
  background: 'background',
  water: 'water',
  coastline: 'coastline',
  lakeOutline: 'lake_outline',
  riverOutline: 'river_outline',
  roadMajor: 'road_major',
  boundary4: 'boundary_4',
  boundary2: 'boundary_2',
} as const

export const FORECAST_OVERLAY_ANCHOR_LAYER_ID = BASEMAP_LAYER_IDS.coastline
