import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl'

import { PLACE_LABEL_LAYER_IDS } from "../map/view/constants"

export type ProbePoint = {
  lon: number
  lat: number
}

function getPlacePoint(feature: MapGeoJSONFeature | undefined): ProbePoint | null {
  if (!feature || feature.geometry.type !== 'Point') return null

  const [lon, lat] = feature.geometry.coordinates
  return typeof lon === 'number' && typeof lat === 'number'
    ? { lon, lat }
    : null
}

export function resolveProbePoint(map: MapLibreMap, event: MapMouseEvent): ProbePoint {
  const placeFeature = map.queryRenderedFeatures(event.point, {
    layers: [...PLACE_LABEL_LAYER_IDS],
  })[0]

  return getPlacePoint(placeFeature) ?? {
    lon: event.lngLat.lng,
    lat: event.lngLat.lat,
  }
}
