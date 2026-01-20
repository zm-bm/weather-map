import { useEffect, useRef } from 'react'
import { Map as MapLibreMap } from 'maplibre-gl'

import type { CycleManifest } from '../api/manifests'
import { buildWeatherStyle } from '../map/styles/buildWeatherStyle'
import { setWeatherVisibility } from '../map/weatherLayers'
import config from '../config'

export function useSyncWeatherOverlay(
	getMap: () => MapLibreMap | null,
	manifest: CycleManifest | null,
	activeLayer?: string | null,
	activeHour?: string | null
) {
	const appliedStyleKeyRef = useRef<string | null>(null)
	const appliedHourKeyRef = useRef<string | null>(null)

	useEffect(() => {
		const map = getMap()
		if (!map || !manifest) return

		const preferredLayer = activeLayer ?? config.defaultLayer
		const layer = manifest.layers.includes(preferredLayer) ? preferredLayer : (manifest.layers[0] ?? preferredLayer)

		const hours = manifest.forecast_hours ?? []
		const preferredHour = activeHour ?? config.defaultHour
		const hour = hours.includes(preferredHour) ? preferredHour : (hours[0] ?? preferredHour)

		const styleKey = `${manifest.cycle}:${layer}`

		const applyVisibility = () => {
			if (hours.length === 0) return
			setWeatherVisibility(map, { layer, hours, activeHour: hour })
			appliedHourKeyRef.current = `${styleKey}:${hour}`
		}

		// Style change (cycle or layer): setStyle, then apply hour visibility once style is ready.
		if (appliedStyleKeyRef.current !== styleKey) {
			appliedStyleKeyRef.current = styleKey
			appliedHourKeyRef.current = null

			const style = buildWeatherStyle(manifest, config, {
				activeLayer: layer,
				insertAfterLayerId: 'water-fill',
			})

			map.setStyle(style)
			map.once('style.load', applyVisibility)
			return
		}

		// Hour change only: just toggle layer visibility (or wait for style to finish loading).
		const hourKey = `${styleKey}:${hour}`
		if (appliedHourKeyRef.current === hourKey) return

		if (map.isStyleLoaded()) applyVisibility()
		else map.once('style.load', applyVisibility)
	}, [getMap, manifest, activeLayer, activeHour])
}

// Back-compat alias (can delete after updating call sites)
export const useApplyCycleMapStyle = useSyncWeatherOverlay
