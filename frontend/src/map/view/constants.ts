
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

export const PLACE_PROBE_SOURCE_ID = 'forecast-place-probes' as const
export const PLACE_PROBE_LAYER_ID = 'forecast-place-probe-labels' as const
export const PLACE_LABEL_LAYER_IDS = [PLACE_PROBE_LAYER_ID] as const

export const placeProbeLayerIds = {
  source: PLACE_PROBE_SOURCE_ID,
  layer: PLACE_PROBE_LAYER_ID,
  labelLayers: PLACE_LABEL_LAYER_IDS,
} as const
