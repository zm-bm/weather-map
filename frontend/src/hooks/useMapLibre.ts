import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, {
  Map as MapLibreMap,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl'

import { normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { CLASSIC_MUSIC_TRACK_URL, MusicControl } from '../map/controls/MusicControl'
import {
  buildNoiseLayer,
  buildNoiseSource,
  ensureNoisePattern,
  NOISE_LAYER_ID,
  NOISE_SOURCE_ID,
} from '../map/noise'
import { joinUrl } from '../url/joinUrl'
import { loadStoredViewport, saveStoredViewport } from '../map/viewportStore'
import { vectorLayerAdapter } from '../map/vector'
import { scalarLayerAdapter } from '../map/scalar'
import { mapStyleTemplate } from '../map/styles/mapStyleTemplate'
import {
  cloneStyle,
  insertLayersAfter,
  mergeSources,
  setGlyphUrl,
  setLocalizedTextField,
  setVectorTiles,
} from '../map/styles/maplibreStyleHelpers'

const VIEWPORT_SAVE_DEBOUNCE_MS = 250
const BASE_VECTOR_TILE_SOURCES = {
  openmaptiles: 'osm-planet',
  coastline: 'coastline',
} as const
const LOCALIZED_LABEL_LAYER_IDS = ['place-country', 'place-city'] as const
const NOISE_INSERT_AFTER_LAYER_ID = 'water-fill'

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
			style: buildInitialMapStyle(config),
		})

		m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
		m.addControl(new MusicControl(CLASSIC_MUSIC_TRACK_URL), 'top-right')
		mapRef.current = m

		const handleStyleLoad = () => {
      try {
        ensureStartupRuntimeOverlays(m)
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

export function buildInitialMapStyle(config: WeatherMapConfig): StyleSpecification {
  const style = cloneStyle(mapStyleTemplate)
  hydrateBaseMapStyle(style, config)
  addNoiseOverlayToStyle(style)
  return style
}

function hydrateBaseMapStyle(style: StyleSpecification, config: WeatherMapConfig) {
  setGlyphUrl(style, config.serverUrl)

  for (const [sourceId, tileSource] of Object.entries(BASE_VECTOR_TILE_SOURCES)) {
    setVectorTiles(style, sourceId, [joinUrl(config.serverUrl, `${tileSource}/{z}/{x}/{y}`)])
  }

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
