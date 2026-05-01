import config from '../../config'
import { useForecastSync } from '../../forecast-sync'
import { useMap } from '../../map/useMap'
import ForecastPlaceProbes from '../ForecastPlaceProbes'

export type ForecastMapProps = {
  containerId?: string
}

export default function ForecastMap({
  containerId = 'map',
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMap({ containerId })

  useForecastSync({
    getMap,
    mapReadyVersion,
    config,
  })

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
      <ForecastPlaceProbes mapRef={mapRef} mapReadyVersion={mapReadyVersion} />
    </div>
  )
}
