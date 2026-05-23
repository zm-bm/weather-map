import { useMapAttributionControl } from './controls/useMapAttributionControl'
import {
  useMapLibre,
  type UseMapLibreResult,
} from './view/useMapLibre'

export type UseMapOptions = {
  containerId?: string
}

export function useMap({
  containerId = 'map',
}: UseMapOptions = {}): UseMapLibreResult {
  const map = useMapLibre({
    containerId,
    center: [-100, 35],
    zoom: 3,
    minZoom: 2,
    maxZoom: 6.99,
  })

  useMapAttributionControl(map.mapRef, map.mapReadyVersion)

  return map
}
