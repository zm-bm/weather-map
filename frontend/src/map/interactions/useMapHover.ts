import { useEffect, type RefObject } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

import { placeProbeLayerIds } from '../view/constants'

const HOVER_FEATURE_ID_PROPERTY = 'id' as const

function getHoveredPlaceId(feature: maplibregl.MapGeoJSONFeature | undefined): string | null {
  const id = feature?.id ?? feature?.properties?.[HOVER_FEATURE_ID_PROPERTY]
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return typeof id === 'string' && id.length > 0 ? id : null
}

function setPlaceHover(map: MapLibreMap, id: string, hovered: boolean): void {
  map.setFeatureState(
    { source: placeProbeLayerIds.source, id },
    { hover: hovered },
  )
}

export function useMapHover(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let hoveredPlaceId: string | null = null
    let attached = false

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
      if (attached || !map.getLayer(placeProbeLayerIds.layer)) return
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

    map.on('load', attach)
    map.on('styledata', attach)
    attach()

    return () => {
      map.off('load', attach)
      map.off('styledata', attach)
      detach()
    }
  }, [mapRef])
}
