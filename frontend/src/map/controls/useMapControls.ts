import { useEffect, useRef, type RefObject } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'

import { MusicControl, TRACK_URL } from '../../components/controls/MusicControl'
import { OptionsControl } from '../../components/controls/OptionsControl'
import { scalarRuntimeOptions } from '../../forecast-layers/scalar'
import { vectorRuntimeOptions } from '../../forecast-layers/vector'

export function useMapControls(
  mapRef: RefObject<MapLibreMap | null>,
  mapReadyVersion: number,
) {
  const attachedMapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || attachedMapRef.current === map) return

    const controls = [
      [new maplibregl.NavigationControl({ showCompass: false }), 'top-right'],
      [new MusicControl({ src: TRACK_URL }), 'top-right'],
      [new OptionsControl({
        scalarOptions: scalarRuntimeOptions,
        vectorOptions: vectorRuntimeOptions,
      }), 'top-right'],
      [new maplibregl.AttributionControl({ compact: true }), 'bottom-left'],
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
