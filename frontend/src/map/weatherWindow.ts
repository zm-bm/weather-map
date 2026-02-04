import type { Map as MapLibreMap, RasterTileSource } from 'maplibre-gl'
import { getTilesUrl } from './tileServer';

export type WeatherWindow = { current: string; prev: string; next: string }
export type WeatherWindowKey = 'current' | 'prev' | 'next'
export const WEATHER_WINDOW_KEYS: readonly WeatherWindowKey[] = ['prev', 'next', 'current'] as const

/** Generic key-based IDs (used for hour keys and window keys). */
export const getWeatherSourceId = (layerName: string, key: string) => `weather_${layerName}_${key}`
export const getWeatherLayerId = (layerName: string, key: string) => `weather-${layerName}-${key}-layer`

export const getWeatherWindowIds = (layerName: string) => ({
	current: {
		sourceId: getWeatherSourceId(layerName, 'current'),
		layerId: getWeatherLayerId(layerName, 'current'),
	},
	prev: {
		sourceId: getWeatherSourceId(layerName, 'prev'),
		layerId: getWeatherLayerId(layerName, 'prev'),
	},
	next: {
		sourceId: getWeatherSourceId(layerName, 'next'),
		layerId: getWeatherLayerId(layerName, 'next'),
	},
} satisfies Record<WeatherWindowKey, { sourceId: string; layerId: string }>)

/**
 * Resolve current/prev/next hours with wrap-around.
 * Returns null when no hours exist, unless a fallback is provided.
 */
export function resolveWeatherWindow(
	hours: string[],
	preferredHour?: string,
	fallback?: string
): WeatherWindow | null {
	if (hours.length === 0) {
		return fallback == null ? null : { current: fallback, prev: fallback, next: fallback }
	}

	const currentIdxRaw = preferredHour ? hours.indexOf(preferredHour) : -1
	const currentIdx = currentIdxRaw >= 0 ? currentIdxRaw : 0
	const prevIdx = (currentIdx - 1 + hours.length) % hours.length
	const nextIdx = (currentIdx + 1) % hours.length

	return { current: hours[currentIdx], prev: hours[prevIdx], next: hours[nextIdx] }
}

export function retargetWeatherWindowSources(
	map: MapLibreMap,
	opts: { layer: string; serverUrl: string; cycle: string; hours: string[]; activeHour: string }
) {
	const { layer, serverUrl, hours, activeHour } = opts
	const window = resolveWeatherWindow(hours, activeHour)
	if (!window) return null

	const ids = getWeatherWindowIds(layer)

	const setTiles = (sourceId: string, hour: string) => {
		const src = map.getSource(sourceId) as RasterTileSource | undefined
		src?.setTiles?.([getTilesUrl(serverUrl, `${opts.cycle}.${layer}.${hour}`)])
	}

	setTiles(ids.current.sourceId, window.current)
	setTiles(ids.prev.sourceId, window.prev)
	setTiles(ids.next.sourceId, window.next)

	return window
}

export function setWeatherWindowOpacity(map: MapLibreMap, opts: { layer: string; activeOpacity?: number }) {
	const { layer, activeOpacity = 0.9 } = opts
	const ids = getWeatherWindowIds(layer)

	for (const key of WEATHER_WINDOW_KEYS) {
		const layerId = ids[key].layerId
		if (!map.getLayer(layerId)) continue
		map.setLayoutProperty(layerId, 'visibility', 'visible')
		try {
			map.setPaintProperty(layerId, 'raster-opacity', key === 'current' ? activeOpacity : 0)
		} catch {
			// ignore
		}
	}
}
