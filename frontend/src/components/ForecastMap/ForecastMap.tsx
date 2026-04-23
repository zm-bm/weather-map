import config from '../../config'
import { useForecastSync } from '../../forecast-sync'
import { useMapClick } from '../../map/interactions/useMapClick'
import { useMap } from '../../map/useMap'

export type ForecastMapProps = {
  containerId?: string
}

export default function ForecastMap({
  containerId = 'map',
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMap({ containerId })

  useMapClick(mapRef)

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
