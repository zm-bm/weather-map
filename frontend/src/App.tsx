import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

import './App.css'
import style, { getMapStyle, getWeatherLayerId } from './mapStyle';
import { usePlaceHover } from './usePlaceHover';
import { manifestBaseUrl } from './config';
import type { cycleManifest } from './types';

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

  const [forecastHours, setForecastHours] = useState<string[]>([])
  const [activeLayer, setActiveLayer] = useState<string>('temp2m')
  const [activeHour, setActiveHour] = useState<string | null>(null)

  const applyWeatherVisibility = useCallback((map: MapLibreMap, layerName: string, hours: string[], active: string) => {
    for (const hour of hours) {
      const id = getWeatherLayerId(layerName, hour)
      if (!map.getLayer(id)) continue
      map.setLayoutProperty(id, 'visibility', hour === active ? 'visible' : 'none')
    }
  }, [])

  useEffect(() => {
    const latestUrl = `${manifestBaseUrl}/latest.json`

    const run = async () => {
      const latestRes = await fetch(latestUrl)
      if (!latestRes.ok) throw new Error(`Failed to fetch latest manifest: ${latestRes.status} ${latestRes.statusText}`)
      const latest = (await latestRes.json()) as { cycle?: unknown }

      const cycle = typeof latest.cycle === 'string' ? latest.cycle : null
      if (!cycle) throw new Error('latest.json missing valid "cycle"')

      const cycleRes = await fetch(`${manifestBaseUrl}/${cycle}.json`)
      if (!cycleRes.ok) throw new Error(`Failed to fetch cycle manifest: ${cycleRes.status} ${cycleRes.statusText}`)
      const manifest = (await cycleRes.json()) as cycleManifest

      setForecastHours(manifest.forecast_hours)
      setActiveLayer(manifest.layers[0])
      setActiveHour((prev) => prev ?? manifest.forecast_hours[0] ?? null)

      const map = mapRef.current
      if (map) {
        map.setStyle(getMapStyle(manifest))
      }
    }

    run().catch((err) => {
      console.error('[manifest]', err)
    })
  }, [mapRef])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeHour || forecastHours.length === 0) return

    const onLoad = () => applyWeatherVisibility(map, activeLayer, forecastHours, activeHour)
    map.on('load', onLoad)
    if (map.isStyleLoaded()) applyWeatherVisibility(map, activeLayer, forecastHours, activeHour)

    return () => {
      map.off('load', onLoad)
    }
  }, [mapRef, forecastHours, activeLayer, activeHour, applyWeatherVisibility])

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      {forecastHours.length > 1 && activeHour && (
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1 }}>
          <button
            type="button"
            onClick={() => {
              const map = mapRef.current
              if (!map) return
              const idx = forecastHours.indexOf(activeHour)
              const next = forecastHours[(idx + 1) % forecastHours.length]
              setActiveHour(next)
              applyWeatherVisibility(map, activeLayer, forecastHours, next)
            }}
          >
            Next hour
          </button>
        </div>
      )}

      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

export default App
