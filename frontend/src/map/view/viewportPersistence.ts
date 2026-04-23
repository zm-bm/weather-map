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
    const viewport = JSON.parse(raw) as Partial<StoredViewport>
    if (!Array.isArray(viewport.center) || viewport.center.length !== 2) return null
    if (typeof viewport.zoom !== 'number') return null
    const [lng, lat] = viewport.center
    if (typeof lng !== 'number' || typeof lat !== 'number') return null
    return { center: [lng, lat], zoom: viewport.zoom }
  } catch {
    return null
  }
}

export function saveStoredViewport(map: MapLibreMap) {
  try {
    const center = map.getCenter()
    const viewport: StoredViewport = {
      center: [Number(center.lng.toFixed(5)), Number(center.lat.toFixed(5))],
      zoom: Number(map.getZoom().toFixed(2)),
    }
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport))
  } catch {
    // ignore (private mode / quota / etc.)
  }
}
