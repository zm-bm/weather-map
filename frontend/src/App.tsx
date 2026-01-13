import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import './App.css'

const LABEL_LAYER_IDS = ['place-city', 'place-country']

function applyLabelLanguage(map: MapLibreMap, locale?: string) {
  const lang = (locale ?? navigator.language ?? 'en').split('-')[0]

  for (const id of LABEL_LAYER_IDS) {
    if (!map.getLayer(id)) continue

    map.setLayoutProperty(id, 'text-field', [
      'coalesce',
      ['get', `name:${lang}`],
      ['get', 'name:latin'],
      ['get', 'name'],
    ])
  }
}

const VIEWPORT_STORAGE_KEY = 'weather-map:viewport'

type StoredViewport = { center: [number, number]; zoom: number }

function loadStoredViewport(): StoredViewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<StoredViewport>
    if (!Array.isArray(v.center) || v.center.length !== 2) return null
    if (typeof v.zoom !== 'number') return null
    const [lng, lat] = v.center
    if (typeof lng !== 'number' || typeof lat !== 'number') return null
    return { center: [lng, lat], zoom: v.zoom }
  } catch {
    return null
  }
}

function saveStoredViewport(map: MapLibreMap) {
  try {
    const c = map.getCenter()
    const v: StoredViewport = {
      center: [Number(c.lng.toFixed(5)), Number(c.lat.toFixed(5))],
      zoom: Number(map.getZoom().toFixed(2)),
    }
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(v))
  } catch {
    // ignore (private mode / quota / etc.)
  }
}

function useMap(basemapStyleUrl: string) {
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const stored = loadStoredViewport()

    const map = new maplibregl.Map({
      container: 'map',
      center: stored?.center ?? [-112.5795, 38.8283],
      zoom: stored?.zoom ?? 5,
      maxZoom: 9,
      style: basemapStyleUrl,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    mapRef.current = map

    let saveTimer: number | undefined
    const scheduleSave = () => {
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => saveStoredViewport(map), 250)
    }

    map.on('moveend', scheduleSave)

    return () => {
      map.off('moveend', scheduleSave)
      if (saveTimer) window.clearTimeout(saveTimer)
      map.remove()
      mapRef.current = null
    }
  }, [basemapStyleUrl])

  return mapRef
}

function useLabelLanguage(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onLoad = () => applyLabelLanguage(map)
    map.on('load', onLoad)

    return () => {
      map.off('load', onLoad)
    }
  }, [mapRef])
}

function usePlaceHover(mapRef: RefObject<MapLibreMap | null>) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let hoveredId: number | string | null = null
    let isAttached = false

    const onMove = (e: maplibregl.MapMouseEvent & maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = e.features?.length ? 'pointer' : ''
      const feature = e.features?.[0]
      if (!feature) return

      const id = feature.id ?? feature.properties?.id
      if (id == null) return

      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'place', id: hoveredId },
          { hover: false },
        )
      }
      hoveredId = id
      map.setFeatureState({ source: 'openmaptiles', sourceLayer: 'place', id }, { hover: true })
    }

    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredId !== null) {
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'place', id: hoveredId },
          { hover: false },
        )
      }
      hoveredId = null
    }

    const attach = () => {
      if (!map.getLayer('place-city')) return
      map.on('mousemove', 'place-city', onMove)
      map.on('mouseleave', 'place-city', onLeave)
      isAttached = true
    }

    const detach = () => {
      if (!isAttached) return
      map.off('mousemove', 'place-city', onMove)
      map.off('mouseleave', 'place-city', onLeave)
      isAttached = false
    }

    map.on('load', attach)

    return () => {
      map.off('load', attach)
      detach()
    }
  }, [mapRef])
}

function useWeatherOverlay(
  mapRef: RefObject<MapLibreMap | null>,
  weatherTilesUrl: string,
) {
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onLoad = () => {
      if (!map.getSource('weather_overlay')) {
        map.addSource('weather_overlay', {
          type: 'raster',
          tiles: [weatherTilesUrl],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 5,
        })
      }

      const firstLineId = map.getStyle().layers?.find((l) => l.type === 'line')?.id
      if (!map.getLayer('weather_overlay_layer')) {
        map.addLayer(
          {
            id: 'weather_overlay_layer',
            type: 'raster',
            source: 'weather_overlay',
            paint: { 'raster-opacity': 1 },
          },
          firstLineId,
        )
      }
    }

    map.on('load', onLoad)

    return () => {
      map.off('load', onLoad)
    }
  }, [mapRef, weatherTilesUrl])
}

function App() {
  const tilesUrl = import.meta.env.VITE_TILES_URL ?? 'http://localhost:8081'
  const basemapStyleUrl = `${tilesUrl}/styles/osm-bright/style.json`

  const layer = '2026010300/temp2m/000'
  const weatherTilesUrl = `${import.meta.env.VITE_SERVER_URL}/tiles/${layer}/{z}/{x}/{y}.png`

  const mapRef = useMap(basemapStyleUrl)

  useLabelLanguage(mapRef)
  usePlaceHover(mapRef)
  useWeatherOverlay(mapRef, weatherTilesUrl)

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

export default App
