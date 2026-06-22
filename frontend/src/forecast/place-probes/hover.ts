import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

import { placeProbeLayerIds, tryMapStyleOperation } from './layer'

const HOVER_FEATURE_ID_PROPERTY = 'id' as const

export type PlaceProbeHoverSession = {
  start: () => void
  destroy: () => void
}

function getHoveredPlaceId(feature: maplibregl.MapGeoJSONFeature | undefined): string | null {
  const id = feature?.id ?? feature?.properties?.[HOVER_FEATURE_ID_PROPERTY]
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return typeof id === 'string' && id.length > 0 ? id : null
}

function setPlaceHover(map: MapLibreMap, id: string, hovered: boolean): void {
  tryMapStyleOperation(map, () => map.setFeatureState(
    { source: placeProbeLayerIds.source, id },
    { hover: hovered },
  ))
}

export function createPlaceProbeHoverSession(
  map: MapLibreMap,
): PlaceProbeHoverSession {
  let hoveredPlaceId: string | null = null
  let attached = false
  let started = false

  const clearHover = () => {
    if (hoveredPlaceId !== null) {
      setPlaceHover(map, hoveredPlaceId, false)
    }
    hoveredPlaceId = null
  }

  const onMove = (e: maplibregl.MapMouseEvent & maplibregl.MapLayerMouseEvent) => {
    const id = getHoveredPlaceId(e.features?.[0])
    if (id == null) {
      clearHover()
      return
    }

    if (hoveredPlaceId === id) return

    clearHover()

    hoveredPlaceId = id
    setPlaceHover(map, hoveredPlaceId, true)
  }

  const onLeave = () => {
    clearHover()
  }

  const attach = () => {
    const layerId = placeProbeLayerIds.layer
    if (attached) return
    if (!tryMapStyleOperation(map, () => map.getLayer(layerId))) return
    map.on('mousemove', layerId, onMove)
    map.on('mouseleave', layerId, onLeave)
    attached = true
  }

  const detach = () => {
    if (!attached) return
    const layerId = placeProbeLayerIds.layer
    map.off('mousemove', layerId, onMove)
    map.off('mouseleave', layerId, onLeave)
    attached = false
  }

  return {
    start() {
      if (started) return
      started = true
      map.on('load', attach)
      map.on('styledata', attach)
      attach()
    },
    destroy() {
      if (!started) return
      map.off('load', attach)
      map.off('styledata', attach)
      detach()
      onLeave()
      started = false
    },
  }
}
