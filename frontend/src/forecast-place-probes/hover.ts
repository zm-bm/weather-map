import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

import { forecastPlaceProbeLayerIds } from './layer'

const HOVER_FEATURE_ID_PROPERTY = 'id' as const

export type ForecastPlaceProbeHoverSession = {
  start: () => void
  destroy: () => void
}

function getHoveredPlaceId(feature: maplibregl.MapGeoJSONFeature | undefined): string | null {
  const id = feature?.id ?? feature?.properties?.[HOVER_FEATURE_ID_PROPERTY]
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return typeof id === 'string' && id.length > 0 ? id : null
}

function setPlaceHover(map: MapLibreMap, id: string, hovered: boolean): void {
  map.setFeatureState(
    { source: forecastPlaceProbeLayerIds.source, id },
    { hover: hovered },
  )
}

export function createForecastPlaceProbeHoverSession(
  map: MapLibreMap,
): ForecastPlaceProbeHoverSession {
  let hoveredPlaceId: string | null = null
  let attached = false
  let started = false

  const onMove = (e: maplibregl.MapMouseEvent & maplibregl.MapLayerMouseEvent) => {
    map.getCanvas().style.cursor = e.features?.length ? 'pointer' : ''
    const id = getHoveredPlaceId(e.features?.[0])
    if (id == null) return

    if (hoveredPlaceId === id) return

    if (hoveredPlaceId !== null) {
      setPlaceHover(map, hoveredPlaceId, false)
    }

    hoveredPlaceId = id
    setPlaceHover(map, hoveredPlaceId, true)
  }

  const onLeave = () => {
    map.getCanvas().style.cursor = ''
    if (hoveredPlaceId !== null) {
      setPlaceHover(map, hoveredPlaceId, false)
    }
    hoveredPlaceId = null
  }

  const attach = () => {
    if (attached || !map.getLayer(forecastPlaceProbeLayerIds.layer)) return
    map.on('mousemove', forecastPlaceProbeLayerIds.layer, onMove)
    map.on('mouseleave', forecastPlaceProbeLayerIds.layer, onLeave)
    attached = true
  }

  const detach = () => {
    if (!attached) return
    map.off('mousemove', forecastPlaceProbeLayerIds.layer, onMove)
    map.off('mouseleave', forecastPlaceProbeLayerIds.layer, onLeave)
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
