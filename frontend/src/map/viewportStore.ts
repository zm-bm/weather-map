import type { Map as MapLibreMap } from 'maplibre-gl'

const VIEWPORT_STORAGE_KEY = 'weather-map:viewport'

export type StoredViewport = {
  center: [number, number]
  zoom: number
}

export function loadStoredViewport(): StoredViewport | null {
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

export function saveStoredViewport(map: MapLibreMap) {
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
