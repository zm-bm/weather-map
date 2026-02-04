import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import type { CycleManifest } from '../api/manifests'
import { buildWeatherStyle } from '../map/styles/buildWeatherStyle'
import { retargetWeatherWindowSources, setWeatherWindowOpacity } from '../map/weatherWindow'
import { type WeatherMapConfig }  from '../config'

function runWhenStyleReady(map: MapLibreMap, fn: () => void) {
	if (map.isStyleLoaded()) {
		fn()
		return
	}
	map.once('style.load', fn)

	return () => {
		map.off('style.load', fn)
	}
}

export function useSyncWeatherOverlay(
	getMap: () => MapLibreMap | null,
	manifest: CycleManifest | null,
	cfg: WeatherMapConfig,
	activeLayer?: string | null,
	activeHour?: string | null,
) {
	const appliedStyleKeyRef = useRef<string | null>(null)
	const appliedHourKeyRef = useRef<string | null>(null)

	useEffect(() => {
		const map = getMap()
		if (!map || !manifest) return

		const preferredLayer = activeLayer ?? cfg.defaultLayer
		const layer = manifest.layers.includes(preferredLayer) ? preferredLayer : (manifest.layers[0] ?? preferredLayer)

		const hours = manifest.forecast_hours ?? []
		const preferredHour = activeHour ?? cfg.defaultHour
		const hour = hours.includes(preferredHour) ? preferredHour : (hours[0] ?? preferredHour)

		const styleKey = `${manifest.cycle}:${layer}`

		const applyWindow = () => {
			const window = retargetWeatherWindowSources(map, {
				layer,
				serverUrl: cfg.serverUrl,
				cycle: manifest.cycle,
				hours,
				activeHour: hour,
			})
			if (!window) return

			setWeatherWindowOpacity(map, { layer, activeOpacity: 0.9 })
			appliedHourKeyRef.current = `${styleKey}:${window.current}`
		}

		// Style change (cycle or layer): setStyle, then retarget once style is ready.
		if (appliedStyleKeyRef.current !== styleKey) {
			appliedStyleKeyRef.current = styleKey
			appliedHourKeyRef.current = null

			const style = buildWeatherStyle(manifest, cfg, {
				activeLayer: layer,
				activeHour: hour,
				insertAfterLayerId: 'water-fill',
			})

			map.setStyle(style)
			return runWhenStyleReady(map, applyWindow)
		}

		// Hour change only: retarget the 3 sources (or wait for style to finish loading).
		const hourKey = `${styleKey}:${hour}`
		if (appliedHourKeyRef.current === hourKey) return

		return runWhenStyleReady(map, applyWindow)
	}, [getMap, manifest, activeLayer, activeHour, cfg])
}
