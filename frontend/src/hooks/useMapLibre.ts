import { useCallback, useEffect, useRef } from 'react'
import maplibregl, { Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'

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

export type UseMapLibreResult = {
	mapRef: React.RefObject<MapLibreMap | null>
	getMap: () => MapLibreMap | null
}

export type UseMapLibreOptions = {
	containerId?: string
	style: StyleSpecification
	center?: [number, number]
	zoom?: number
	maxZoom?: number
}

export function useMapLibre(options: UseMapLibreOptions): UseMapLibreResult {
	const {
		containerId = 'map',
		style,
		center = [-112.5795, 38.8283],
		zoom = 5,
		maxZoom = 9,
	} = options

	const mapRef = useRef<MapLibreMap | null>(null)
	const getMap = useCallback(() => mapRef.current, [])

	useEffect(() => {
		const stored = loadStoredViewport()

		const m = new maplibregl.Map({
			container: containerId,
			center: stored?.center ?? center,
			zoom: stored?.zoom ?? zoom,
			maxZoom,
			style,
		})

		m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

		mapRef.current = m

		let saveTimer: number | undefined
		const scheduleSave = () => {
			if (saveTimer) window.clearTimeout(saveTimer)
			saveTimer = window.setTimeout(() => saveStoredViewport(m), 250)
		}

		m.on('moveend', scheduleSave)

		return () => {
			m.off('moveend', scheduleSave)
			if (saveTimer) window.clearTimeout(saveTimer)
			m.remove()
			mapRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []) // intentionally mount/unmount only

	return { mapRef, getMap }
}
