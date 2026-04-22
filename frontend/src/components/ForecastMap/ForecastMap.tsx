import config from '../../config'
import { useForecastSync } from '../../forecast-sync'
import { useMapControls } from '../../hooks/useMapControls'
import { useMapClickProbe } from '../../map-probe/useMapClickProbe'
import { useMapHover } from '../../hooks/useMapHover'
import { useMapLibre } from '../../hooks/useMapLibre'
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../../map/config'

export type ForecastMapProps = {
  containerId?: string
}

export default function ForecastMap({
  containerId = 'map',
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMapLibre({
    config: config,
    containerId,
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
  })

  useMapHover(mapRef)
  useMapClickProbe(mapRef)
  useMapControls(mapRef, mapReadyVersion)
  
  useForecastSync({
    getMap,
    mapReadyVersion,
    config,
  })

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
    </div>
  )
}
