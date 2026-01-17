import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

import './App.css'
import style, { WEATHER_LAYER_T000_ID, WEATHER_LAYER_T003_ID } from './style';
import { usePlaceHover } from './usePlaceHover';

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

function useMap() {
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const stored = loadStoredViewport()

    const map = new maplibregl.Map({
      container: 'map',
      center: stored?.center ?? [-112.5795, 38.8283],
      zoom: stored?.zoom ?? 5,
      maxZoom: 9,
      style: style,
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
  }, [])

  return mapRef
}

function App() {
  const mapRef = useMap()
  usePlaceHover(mapRef)

  const [showT000, setShowT000] = useState(true)

  const applyWeatherVisibility = useCallback((map: MapLibreMap, show0: boolean) => {
    // Guard in case style/layers aren't ready yet
    if (!map.getLayer(WEATHER_LAYER_T000_ID) || !map.getLayer(WEATHER_LAYER_T003_ID)) return

    map.setLayoutProperty(WEATHER_LAYER_T000_ID, 'visibility', show0 ? 'visible' : 'none')
    map.setLayoutProperty(WEATHER_LAYER_T003_ID, 'visibility', show0 ? 'none' : 'visible')
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onLoad = () => applyWeatherVisibility(map, showT000)
    map.on('load', onLoad)

    // If already loaded (fast refresh), apply immediately too
    if (map.isStyleLoaded()) applyWeatherVisibility(map, showT000)

    return () => {
      map.off('load', onLoad)
    }
  }, [mapRef, showT000, applyWeatherVisibility])

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1 }}>
        <button
          type="button"
          onClick={() => {
            const next = !showT000
            setShowT000(next)
            const map = mapRef.current
            if (map) applyWeatherVisibility(map, next)
          }}
        >
          {showT000 ? 'Show t+003' : 'Show t+000'}
        </button>
      </div>

      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

export default App
