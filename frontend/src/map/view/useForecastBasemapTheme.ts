import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  applyForecastBasemapStyle,
  basemapStyleForForecastRasterLayer,
} from './basemapTheme'

type UseForecastBasemapThemeArgs = {
  map: MapLibreMap | null
  selectedLayerId: string | null
}

export function useForecastBasemapTheme({
  map,
  selectedLayerId,
}: UseForecastBasemapThemeArgs): void {
  useEffect(() => {
    if (!map) return
    applyForecastBasemapStyle(map, basemapStyleForForecastRasterLayer(selectedLayerId))
  }, [map, selectedLayerId])
}
