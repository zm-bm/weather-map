import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, {
  Map as MapLibreMap,
} from 'maplibre-gl'

import { normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { TRACK_URL, MusicControl } from '../map/controls/MusicControl'
import { OptionsControl } from '../map/controls/OptionsControl'
import {
  ensureNoisePattern,
  NOISE_LAYER_ID,
} from '../map/noise'
import { loadStoredViewport, saveStoredViewport } from '../map/viewportStore'
import { vectorLayerAdapter, vectorRuntimeOptions } from '../map/vector'
import { scalarLayerAdapter, scalarRuntimeOptions } from '../map/scalar'
import { getScalarController } from '../map/scalar/controller'
import { getVectorController } from '../map/vector/controller'
import { buildMapStyle } from '../map/styles/helpers'

const DEBUG_BASEMAP_ONLY = false
const DEBUG_LOG_ZOOM_LEVEL = true

const VIEWPORT_SAVE_DEBOUNCE_MS = 250
const BASEMAP_ONLY_HIDDEN_STYLE_LAYER_IDS = ['hillshade', 'esri-hillshade', NOISE_LAYER_ID] as const

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
      style: buildMapStyle(config),
    })

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new MusicControl(TRACK_URL), 'top-right')
    m.addControl(new OptionsControl({
      scalarOptions: scalarRuntimeOptions,
      vectorOptions: vectorRuntimeOptions,
    }), 'top-right')
    mapRef.current = m

    const handleStyleLoad = () => {
      try {
        ensureNoisePattern(m)

        if (!m.getLayer(scalarLayerAdapter.layerId)) {
          try {
            m.addLayer(scalarLayerAdapter.createLayer(), NOISE_LAYER_ID)
          } catch {
            m.addLayer(scalarLayerAdapter.createLayer())
          }
        }

        if (!m.getLayer(vectorLayerAdapter.layerId)) {
          m.addLayer(vectorLayerAdapter.createLayer())
        }

        const showAuxiliaryLayers = !DEBUG_BASEMAP_ONLY
        for (const layerId of BASEMAP_ONLY_HIDDEN_STYLE_LAYER_IDS) {
          if (!m.getLayer(layerId)) continue
          m.setLayoutProperty(layerId, 'visibility', showAuxiliaryLayers ? 'visible' : 'none')
        }

        getScalarController(m)?.setEnabled(showAuxiliaryLayers)
        getVectorController(m)?.setEnabled(showAuxiliaryLayers)
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

    const handleZoomEnd = () => {
      if (!DEBUG_LOG_ZOOM_LEVEL) return
      console.log(`[map] zoom ${m.getZoom().toFixed(2)}`)
    }

    m.on('moveend', scheduleSave)
    m.on('zoomend', handleZoomEnd)
    m.on('style.load', handleStyleLoad)
    m.on('error', handleMapError)
    if (m.isStyleLoaded()) {
      handleStyleLoad()
    }

    return () => {
      m.off('moveend', scheduleSave)
      m.off('zoomend', handleZoomEnd)
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
