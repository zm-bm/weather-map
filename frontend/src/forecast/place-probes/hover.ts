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
    map.getCanvas().style.cursor = e.features?.length ? 'pointer' : ''
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
    map.getCanvas().style.cursor = ''
    clearHover()
  }

  const attach = () => {
    if (attached || !tryMapStyleOperation(map, () => map.getLayer(placeProbeLayerIds.layer))) return
    map.on('mousemove', placeProbeLayerIds.layer, onMove)
    map.on('mouseleave', placeProbeLayerIds.layer, onLeave)
    attached = true
  }

  const detach = () => {
    if (!attached) return
    map.off('mousemove', placeProbeLayerIds.layer, onMove)
    map.off('mouseleave', placeProbeLayerIds.layer, onLeave)
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
