import type { Map as MapLibreMap } from 'maplibre-gl'

import { getWeatherLayerId } from './styles/weatherIds'

export function setWeatherVisibility(
	map: MapLibreMap,
	opts: { layer: string; hours: string[]; activeHour: string }
) {
	const { layer, hours, activeHour } = opts
	for (const hour of hours) {
		const id = getWeatherLayerId(layer, hour)
		if (!map.getLayer(id)) continue
		map.setLayoutProperty(id, 'visibility', hour === activeHour ? 'visible' : 'none')
	}
}
