import config from '../../config'
import { useForecastMapStatus } from '../../hooks/useForecastMapStatus'
import { useMapControls } from '../../hooks/useMapControls'
import { useFrameSyncRunner } from '../../hooks/useFrameSyncRunner'
import { useMapClick } from '../../hooks/useMapClick'
import { useStartupSyncState } from '../../hooks/useStartupSyncState'
import { useMapHover } from '../../hooks/useMapHover'
import { useMapLibre } from '../../hooks/useMapLibre'
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../../map/config'
import { useFrameSyncRequest } from '../../state/useFrameSyncRequest'

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
  useMapClick(mapRef)
  useMapControls(mapRef, mapReadyVersion)

  const syncState = useStartupSyncState()
  const syncRequest = useFrameSyncRequest(syncState.retryToken)
  useFrameSyncRunner({
    getMap,
    mapReadyVersion,
    config,
    syncRequest,
    syncState,
  })

  useForecastMapStatus({
    status: syncState.status,
  })

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
    </div>
  )
}
