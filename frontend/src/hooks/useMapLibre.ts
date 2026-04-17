import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, {
  Map as MapLibreMap,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl'

import { normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { TRACK_URL, MusicControl } from '../map/controls/MusicControl'
import { OptionsControl } from '../map/controls/OptionsControl'
import {
  buildNoiseLayer,
  buildNoiseSource,
  ensureNoisePattern,
  NOISE_LAYER_ID,
  NOISE_SOURCE_ID,
} from '../map/noise'
import { loadStoredViewport, saveStoredViewport } from '../map/viewportStore'
import { vectorLayerAdapter, vectorRuntimeOptions } from '../map/vector'
import { scalarLayerAdapter, scalarRuntimeOptions } from '../map/scalar'
import { getScalarController } from '../map/scalar/controller'
import { getVectorController } from '../map/vector/controller'
import { mapStyleTemplate } from '../map/styles/mapStyleTemplate'
import { hydrateCoreSources } from '../map/styles/core/sources'
import {
  cloneStyle,
  insertLayersAfter,
  mergeSources,
  setGlyphUrl,
  setLocalizedTextField,
} from '../map/styles/maplibreStyleHelpers'

const DEBUG_BASEMAP_ONLY = true 
const DEBUG_LOG_ZOOM_LEVEL = true

const VIEWPORT_SAVE_DEBOUNCE_MS = 250
const LOCALIZED_LABEL_LAYER_IDS = ['place-country', 'place-city'] as const
const NOISE_INSERT_AFTER_LAYER_ID = 'highway'
const BASEMAP_ONLY_HIDDEN_STYLE_LAYER_IDS = ['esri-hillshade', NOISE_LAYER_ID] as const

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
      style: buildInitialMapStyle(config),
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
        ensureStartupRuntimeOverlays(m)
        applyBasemapOnlyVisibility(m, DEBUG_BASEMAP_ONLY)
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

export function buildInitialMapStyle(config: WeatherMapConfig): StyleSpecification {
  const style = cloneStyle(mapStyleTemplate)
  hydrateBaseMapStyle(style, config)
  addNoiseOverlayToStyle(style)
  return style
}

function hydrateBaseMapStyle(style: StyleSpecification, config: WeatherMapConfig) {
  setGlyphUrl(style, config.serverUrl)
  hydrateCoreSources(style, config.serverUrl)

  for (const layerId of LOCALIZED_LABEL_LAYER_IDS) {
    setLocalizedTextField(style, layerId, config.language)
  }
}

function addNoiseOverlayToStyle(style: StyleSpecification) {
  mergeSources(style, {
    [NOISE_SOURCE_ID]: buildNoiseSource() as NonNullable<StyleSpecification['sources']>[string],
  })

  const hasNoiseLayer = (style.layers ?? []).some((layer) => layer.id === NOISE_LAYER_ID)
  if (hasNoiseLayer) return

  insertLayersAfter(style, NOISE_INSERT_AFTER_LAYER_ID, [buildNoiseLayer() as LayerSpecification])
}

function ensureStartupRuntimeOverlays(map: MapLibreMap) {
  ensureNoisePattern(map)
  ensureScalarLayer(map)
  ensureVectorLayer(map)
}

function ensureScalarLayer(map: MapLibreMap) {
  if (map.getLayer(scalarLayerAdapter.layerId)) return

  try {
    map.addLayer(scalarLayerAdapter.createLayer(), NOISE_LAYER_ID)
  } catch {
    map.addLayer(scalarLayerAdapter.createLayer())
  }
}

function ensureVectorLayer(map: MapLibreMap) {
  if (map.getLayer(vectorLayerAdapter.layerId)) return
  map.addLayer(vectorLayerAdapter.createLayer())
}

function applyBasemapOnlyVisibility(map: MapLibreMap, basemapOnly: boolean) {
  const showAuxiliaryLayers = !basemapOnly

  for (const layerId of BASEMAP_ONLY_HIDDEN_STYLE_LAYER_IDS) {
    setLayerVisibility(map, layerId, showAuxiliaryLayers)
  }

  getScalarController(map)?.setEnabled(showAuxiliaryLayers)
  getVectorController(map)?.setEnabled(showAuxiliaryLayers)
}

function setLayerVisibility(map: MapLibreMap, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
}
