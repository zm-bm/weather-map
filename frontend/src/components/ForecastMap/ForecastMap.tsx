import { useState } from 'react'

import config from '../../config'
import {
  DEFAULT_FORECAST_RENDER_PROFILE,
  useForecastRenderHost,
  type ForecastRenderProfile,
} from '../../forecast-render'
import { useForecastSync } from '../../forecast-sync'
import { useMap } from '../../map/useMap'
import ForecastPlaceProbes from '../ForecastPlaceProbes'
import MapControlRail from '../MapControlRail'

export type ForecastMapProps = {
  containerId?: string
}

const FIELD_ONLY_RENDER_PROFILE = {
  key: 'field-only',
  rendererIds: ['field'],
} as const satisfies ForecastRenderProfile

export default function ForecastMap({
  containerId = 'map',
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMap({ containerId })
  const [particlesEnabled, setParticlesEnabled] = useState(true)
  const renderProfile = particlesEnabled
    ? DEFAULT_FORECAST_RENDER_PROFILE
    : FIELD_ONLY_RENDER_PROFILE
  const renderHost = useForecastRenderHost({
    getMap,
    mapReadyVersion,
    profile: renderProfile,
  })

  useForecastSync({
    renderHost,
    config,
  })

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
      <MapControlRail
        mapRef={mapRef}
        mapReadyVersion={mapReadyVersion}
        particlesEnabled={particlesEnabled}
        onParticlesEnabledChange={setParticlesEnabled}
      />
      <ForecastPlaceProbes mapRef={mapRef} mapReadyVersion={mapReadyVersion} />
    </div>
  )
}
