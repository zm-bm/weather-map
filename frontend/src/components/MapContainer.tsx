import { useMemo } from 'react'

import config from '../config'
import type { CycleManifest } from '../api/manifests'
import { useMapLibre } from '../hooks/useMapLibre'
import { useMapHover } from '../hooks/useMapHover'
import { useSyncWeatherOverlay } from '../hooks/useSyncWeatherOverlay'
import { buildBaseStyle } from '../map/styles/buildWeatherStyle'

type Props = {
	manifest: CycleManifest | null
	activeLayer: string
	activeHour: string
	containerId?: string
}

export default function MapContainer({ manifest, activeLayer, activeHour, containerId = 'map' }: Props) {
	const baseStyle = useMemo(() => buildBaseStyle(config), [])
	const { mapRef, getMap } = useMapLibre({ style: baseStyle, containerId })

	useMapHover(mapRef)
	useSyncWeatherOverlay(getMap, manifest, config, activeLayer, activeHour)

	return <div id={containerId} style={{ height: '100%', width: '100%' }} />
}
