import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  loadLocalStorageJson,
  saveLocalStorageJson,
} from '@/core/storage/localStorage'

const VIEWPORT_STORAGE_KEY = 'weather-map:viewport'

export type StoredViewport = {
  center: [number, number]
  zoom: number
}

export function loadStoredViewport(): StoredViewport | null {
  return loadLocalStorageJson(VIEWPORT_STORAGE_KEY, validateStoredViewport)
}

export function saveStoredViewport(map: MapLibreMap) {
  try {
    const center = map.getCenter()
    const viewport: StoredViewport = {
      center: [Number(center.lng.toFixed(5)), Number(center.lat.toFixed(5))],
      zoom: Number(map.getZoom().toFixed(2)),
    }
    saveLocalStorageJson(VIEWPORT_STORAGE_KEY, viewport)
  } catch {
    // ignore
  }
}

function validateStoredViewport(value: unknown): StoredViewport | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.center) || value.center.length !== 2) return null
  if (typeof value.zoom !== 'number') return null
  const [lng, lat] = value.center
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  return { center: [lng, lat], zoom: value.zoom }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
