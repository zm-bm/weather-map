import { useEffect, type RefObject } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

import { getScalarProbeFrame, probeScalarFrame } from '../map/scalar'
import { useMapProbe } from '../state/MapProbeContext'

export function useMapClick(mapRef: RefObject<MapLibreMap | null>) {
  const { setLastProbe } = useMapProbe()

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onClick = (event: MapMouseEvent) => {
      const frame = getScalarProbeFrame(map)
      const lon = event.lngLat.lng
      const lat = event.lngLat.lat
      const probe = frame ? probeScalarFrame(frame, { lon, lat }) : null

      setLastProbe({
        variableId: frame?.variableId ?? null,
        lon,
        lat,
        value: probe?.value ?? null,
      })
    }

    map.on('click', onClick)

    return () => {
      map.off('click', onClick)
    }
  }, [mapRef, setLastProbe])
}
