export const BASEMAP_SOURCE_ID = 'basemap' as const

export const BASEMAP_SOURCE_LAYER_IDS = {
  water: 'water',
  earth: 'earth',
  landcover: 'landcover',
  landuse: 'landuse',
  roads: 'roads',
  boundaries: 'boundaries',
  places: 'places',
} as const

export const BASEMAP_LAYER_IDS = {
  background: 'background',
  earthMask: 'earth_mask',
  water: 'water',
  landcoverContext: 'landcover_context',
  landuseContext: 'landuse_context',
  coastlineShadow: 'coastline_shadow',
  lakeFill: 'lake_fill',
  coastline: 'coastline',
  lakeOutline: 'lake_outline',
  riverOutline: 'river_outline',
  roadMajor: 'road_major',
  boundary4: 'boundary_4',
  boundary2: 'boundary_2',
} as const

export const FORECAST_OVERLAY_ANCHOR_LAYER_ID = BASEMAP_LAYER_IDS.landcoverContext
