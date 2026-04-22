import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, {
  Map as MapLibreMap,
} from 'maplibre-gl'

import { normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { loadStoredViewport, saveStoredViewport } from '../map/viewportStore'
import { buildMapStyle, onStyleLoad } from '../map/styles/helpers'

const VIEWPORT_SAVE_DEBOUNCE_MS = 250

export type UseMapLibreResult = {
  mapRef: React.RefObject<MapLibreMap | null>
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
}

export type UseMapLibreOptions = {
  containerId?: string
  config: WeatherMapConfig
  center: [number, number]
  zoom: number
  minZoom: number
  maxZoom: number
}

export function useMapLibre({
  containerId = 'map',
  config,
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

    const m = new maplibregl.Map({
      container: containerId,
      center: stored?.center ?? center,
      zoom: stored?.zoom ?? zoom,
      minZoom,
      maxZoom,
      dragRotate: false,
      attributionControl: false,
      style: buildMapStyle(config),
    })

    mapRef.current = m

    const handleStyleLoad = () => {
      try {
        onStyleLoad(m)
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
