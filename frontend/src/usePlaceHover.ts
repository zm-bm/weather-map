import { useEffect, type RefObject } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

export function usePlaceHover(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let hoveredId: number | string | null = null
    let isAttached = false

    const onMove = (e: maplibregl.MapMouseEvent & maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = e.features?.length ? 'pointer' : ''
      const feature = e.features?.[0]
      if (!feature) return

      const id = feature.id ?? feature.properties?.id
      if (id == null) return

      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'place', id: hoveredId },
          { hover: false },
        )
      }
      hoveredId = id
      map.setFeatureState({ source: 'openmaptiles', sourceLayer: 'place', id }, { hover: true })
    }

    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredId !== null) {
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'place', id: hoveredId },
          { hover: false },
        )
      }
      hoveredId = null
    }

    const attach = () => {
      if (!map.getLayer('place-city')) return
      map.on('mousemove', 'place-city', onMove)
      map.on('mouseleave', 'place-city', onLeave)
      isAttached = true
    }

    const detach = () => {
      if (!isAttached) return
      map.off('mousemove', 'place-city', onMove)
      map.off('mouseleave', 'place-city', onLeave)
      isAttached = false
    }

    map.on('load', attach)

    return () => {
      map.off('load', attach)
      detach()
    }
  }, [mapRef])
}
