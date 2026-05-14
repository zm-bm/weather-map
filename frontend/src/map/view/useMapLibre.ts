import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, {
  Map as MapLibreMap,
} from 'maplibre-gl'
import { Protocol } from 'pmtiles'

import { normalizeError } from '../../abort'
import config from '../../config'
import { installForecastRenderers } from '../../forecast-render'
import { buildMapStyle } from './buildMapStyle'
import { loadStoredViewport, saveStoredViewport } from './viewportPersistence'

const PMTILES_PROTOCOL = 'pmtiles'
const VIEWPORT_SAVE_DEBOUNCE_MS = 250
let pmtilesProtocolInstalled = false

export type UseMapLibreResult = {
  mapRef: React.RefObject<MapLibreMap | null>
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
}

export type UseMapLibreOptions = {
  containerId?: string
  center: [number, number]
  zoom: number
  minZoom: number
  maxZoom: number
}

function ensurePmtilesProtocol(url: string | undefined): void {
  if (!url) return
  if (!url.startsWith(`${PMTILES_PROTOCOL}://`)) return
  if (pmtilesProtocolInstalled) return

  const protocol = new Protocol()
  maplibregl.addProtocol(PMTILES_PROTOCOL, protocol.tile)
  pmtilesProtocolInstalled = true
}

export function useMapLibre({
  containerId = 'map',
  center,
  zoom,
  minZoom,
  maxZoom,
}: UseMapLibreOptions): UseMapLibreResult {
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReadyVersion, setMapReadyVersion] = useState(0)
  const getMap = useCallback(() => {
    return mapRef.current
  }, [])

  useEffect(() => {
    const stored = loadStoredViewport()
    ensurePmtilesProtocol(config.basemapUrl)
    const style = buildMapStyle(config)

    const m = new maplibregl.Map({
      container: containerId,
      center: stored?.center ?? center,
      zoom: stored?.zoom ?? zoom,
      minZoom,
      maxZoom,
      dragRotate: false,
      attributionControl: false,
      fadeDuration: 0,
      style,
    })

    mapRef.current = m

    const handleStyleLoad = () => {
      try {
        installForecastRenderers(m)
      } catch (error) {
        const normalizedError = normalizeError(error)
        console.error('[map] startup overlay initialization failed', normalizedError)
      } finally {
        setMapReadyVersion((value) => value + 1)
      }
    }

    const handleMapError = (event: { error?: unknown }) => {
      console.warn('[map] MapLibre error', event.error ?? event)
    }

    let saveTimer: number | undefined
    const scheduleSave = () => {
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => saveStoredViewport(m), VIEWPORT_SAVE_DEBOUNCE_MS)
    }

    m.on('moveend', scheduleSave)
    m.on('style.load', handleStyleLoad)
    m.on('error', handleMapError)
    if (m.isStyleLoaded()) {
      handleStyleLoad()
    }

    return () => {
      m.off('moveend', scheduleSave)
      m.off('style.load', handleStyleLoad)
      m.off('error', handleMapError)
      if (saveTimer) window.clearTimeout(saveTimer)
      m.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally mount/unmount only

  return { mapRef, getMap, mapReadyVersion }
}
