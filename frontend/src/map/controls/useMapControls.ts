import { useEffect, useRef, type RefObject } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'

import config from '../../config'
import { MusicControl } from '../../components/controls/MusicControl'
import { OptionsControl } from '../../components/controls/OptionsControl'
import { scalarRuntimeOptions } from '../../forecast-layers/scalar'
import { vectorRuntimeOptions } from '../../forecast-layers/vector'
import { joinUrl } from '../../url/joinUrl'

export function useMapControls(
  mapRef: RefObject<MapLibreMap | null>,
  mapReadyVersion: number,
) {
  const attachedMapRef = useRef<MapLibreMap | null>(null)
  const playlistUrl = joinUrl(config.artifactBaseUrl, 'radio/playlist.json')

  useEffect(() => {
    const map = mapRef.current
    if (!map || attachedMapRef.current === map) return

    const controls = [
      [new maplibregl.NavigationControl({ showCompass: false }), 'top-right'],
      [new MusicControl({ playlistUrl }), 'top-right'],
      [new OptionsControl({
        scalarOptions: scalarRuntimeOptions,
        vectorOptions: vectorRuntimeOptions,
      }), 'top-right'],
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
  }, [mapReadyVersion, mapRef, playlistUrl])
}
