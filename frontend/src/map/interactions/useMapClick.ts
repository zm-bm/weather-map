import { useEffect, type RefObject } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

import { resolveProbePoint } from '../../map-probe/click'
import { useMapProbe } from '../../map-probe/context'

export function useMapClick(mapRef: RefObject<MapLibreMap | null>) {
  const { setLastProbe } = useMapProbe()

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onClick = (event: MapMouseEvent) => {
      const { lon, lat } = resolveProbePoint(map, event)

      setLastProbe({
        lon,
        lat,
      })
    }

    map.on('click', onClick)

    return () => {
      map.off('click', onClick)
    }
  }, [mapRef, setLastProbe])
}
