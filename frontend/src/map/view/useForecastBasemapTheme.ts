import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  applyBasemapTheme,
  basemapThemeForForecastLayer,
} from './basemapTheme'

type UseForecastBasemapThemeArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  selectedLayerId: string | null
}

export function useForecastBasemapTheme({
  getMap,
  mapReadyVersion,
  selectedLayerId,
}: UseForecastBasemapThemeArgs): void {
  useEffect(() => {
    if (mapReadyVersion < 1) return
    const map = getMap()
    if (!map) return
    applyBasemapTheme(map, basemapThemeForForecastLayer(selectedLayerId))
  }, [getMap, mapReadyVersion, selectedLayerId])
}
