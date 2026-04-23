import { useEffect, type RefObject } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

import { PLACE_LABEL_LAYER_IDS } from './placeLayers'

const HOVER_SOURCE_ID = 'openmaptiles' as const
const HOVER_SOURCE_LAYER_ID = 'place' as const
const HOVER_FEATURE_NAME_PROPERTY = 'name' as const

function getHoveredPlaceName(feature: maplibregl.MapGeoJSONFeature | undefined): string | null {
  const name = feature?.id ?? feature?.properties?.[HOVER_FEATURE_NAME_PROPERTY]
  return typeof name === 'string' && name.length > 0 ? name : null
}

function setPlaceHover(map: MapLibreMap, name: string, hovered: boolean): void {
  map.setFeatureState(
    { source: HOVER_SOURCE_ID, sourceLayer: HOVER_SOURCE_LAYER_ID, id: name },
    { hover: hovered },
  )
}

export function useMapHover(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let hoveredName: string | null = null
    let attachedLayerIds: string[] = []

    const onMove = (e: maplibregl.MapMouseEvent & maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = e.features?.length ? 'pointer' : ''
      const name = getHoveredPlaceName(e.features?.[0])
      if (name == null) return

      if (hoveredName === name) return

      if (hoveredName !== null) {
        setPlaceHover(map, hoveredName, false)
      }

      hoveredName = name
      setPlaceHover(map, hoveredName, true)
    }

    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredName !== null) {
        setPlaceHover(map, hoveredName, false)
      }
      hoveredName = null
    }

    const attach = () => {
      if (attachedLayerIds.length > 0) return
      const layerIds = PLACE_LABEL_LAYER_IDS.filter((layerId) => Boolean(map.getLayer(layerId)))
      if (layerIds.length === 0) return

      for (const layerId of layerIds) {
        map.on('mousemove', layerId, onMove)
        map.on('mouseleave', layerId, onLeave)
      }

      attachedLayerIds = layerIds
    }

    const detach = () => {
      if (attachedLayerIds.length === 0) return

      for (const layerId of attachedLayerIds) {
        map.off('mousemove', layerId, onMove)
        map.off('mouseleave', layerId, onLeave)
      }

      attachedLayerIds = []
    }

    map.on('load', attach)
    attach()

    return () => {
      map.off('load', attach)
      detach()
    }
  }, [mapRef])
}
