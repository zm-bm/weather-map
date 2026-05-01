
export const BASEMAP_SOURCE_ID = 'basemap' as const
export const PLACE_SOURCE_LAYER_ID = 'places' as const

export const PLACE_PROBE_SOURCE_ID = 'forecast-place-probes' as const
export const PLACE_PROBE_LAYER_ID = 'forecast-place-probe-labels' as const
export const PLACE_LABEL_LAYER_IDS = [PLACE_PROBE_LAYER_ID] as const

export const basemapLayerIds = {
  source: BASEMAP_SOURCE_ID,
  placeSourceLayer: PLACE_SOURCE_LAYER_ID,
} as const

export const placeProbeLayerIds = {
  source: PLACE_PROBE_SOURCE_ID,
  layer: PLACE_PROBE_LAYER_ID,
  labelLayers: PLACE_LABEL_LAYER_IDS,
} as const
