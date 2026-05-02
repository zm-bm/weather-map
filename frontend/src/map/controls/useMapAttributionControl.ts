import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, type RefObject } from 'react'

export function useMapAttributionControl(
  mapRef: RefObject<MapLibreMap | null>,
  mapReadyVersion: number,
) {
  const attachedMapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || attachedMapRef.current === map) return

    const controls = [
      [new maplibregl.AttributionControl({ compact: true }), 'bottom-right'],
    ] as const

    for (const [control, position] of controls) {
      map.addControl(control, position)
    }

    attachedMapRef.current = map

    return () => {
      attachedMapRef.current = null
      for (const [control] of [...controls].reverse()) {
        if (map.hasControl(control)) {
          map.removeControl(control)
        }
      }
    }
  }, [mapReadyVersion, mapRef])
}
