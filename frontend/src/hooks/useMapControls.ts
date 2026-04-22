import { useEffect, useRef, type RefObject } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'

import { MusicControl, TRACK_URL } from '../components/controls/MusicControl'
import { OptionsControl } from '../components/controls/OptionsControl'
import { scalarRuntimeOptions } from '../map/scalar'
import { vectorRuntimeOptions } from '../map/vector'

export function useMapControls(
  mapRef: RefObject<MapLibreMap | null>,
  mapReadyVersion: number,
) {
  const attachedMapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || attachedMapRef.current === map) return

    const navigationControl = new maplibregl.NavigationControl({ showCompass: false })
    const attributionControl = new maplibregl.AttributionControl({ compact: true })
    const musicControl = new MusicControl({ src: TRACK_URL })
    const optionsControl = new OptionsControl({
      scalarOptions: scalarRuntimeOptions,
      vectorOptions: vectorRuntimeOptions,
    })

    map.addControl(navigationControl, 'top-right')
    map.addControl(musicControl, 'top-right')
    map.addControl(optionsControl, 'top-right')
    map.addControl(attributionControl, 'bottom-left');

    attachedMapRef.current = map

    return () => {
      attachedMapRef.current = null
      if (map.hasControl(optionsControl)) {
        map.removeControl(optionsControl)
      }
      if (map.hasControl(musicControl)) {
        map.removeControl(musicControl)
      }
      if (map.hasControl(navigationControl)) {
        map.removeControl(navigationControl)
      }
      if (map.hasControl(attributionControl)) {
        map.removeControl(attributionControl)
      }
    }
  }, [mapReadyVersion, mapRef])
}
