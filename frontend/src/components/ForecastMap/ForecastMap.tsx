import { useMemo, useState } from 'react'

import config from '../../config'
import {
  useForecastRenderHost,
  type ForecastRendererId,
  type ForecastRenderProfile,
} from '../../forecast-render'
import { useForecastSync } from '../../forecast-sync'
import { useMap } from '../../map/useMap'
import ForecastPlaceProbes from '../ForecastPlaceProbes'
import MapControlRail from '../MapControlRail'

export type ForecastMapProps = {
  containerId?: string
}

type ForecastMapRenderOptions = {
  particlesEnabled: boolean
  pressureContoursEnabled: boolean
}

function createForecastMapRenderProfile({
  particlesEnabled,
  pressureContoursEnabled,
}: ForecastMapRenderOptions): ForecastRenderProfile {
  const rendererIds: ForecastRendererId[] = ['field', 'field-overlay']
  if (pressureContoursEnabled) rendererIds.push('contour-overlay')
  if (particlesEnabled) rendererIds.push('particles')

  return {
    key: [
      'field',
      pressureContoursEnabled ? 'contours' : 'no-contours',
      particlesEnabled ? 'particles' : 'no-particles',
    ].join('-'),
    rendererIds,
  }
}

export default function ForecastMap({
  containerId = 'map',
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMap({ containerId })
  const [particlesEnabled, setParticlesEnabled] = useState(true)
  const [pressureContoursEnabled, setPressureContoursEnabled] = useState(true)
  const renderProfile = useMemo(
    () => createForecastMapRenderProfile({
      particlesEnabled,
      pressureContoursEnabled,
    }),
    [particlesEnabled, pressureContoursEnabled],
  )
  const renderHost = useForecastRenderHost({
    getMap,
    mapReadyVersion,
    profile: renderProfile,
  })

  useForecastSync({
    renderHost,
    config,
    pressureContoursEnabled,
  })

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
      <MapControlRail
        mapRef={mapRef}
        mapReadyVersion={mapReadyVersion}
        particlesEnabled={particlesEnabled}
        pressureContoursEnabled={pressureContoursEnabled}
        onParticlesEnabledChange={setParticlesEnabled}
        onPressureContoursEnabledChange={setPressureContoursEnabled}
      />
      <ForecastPlaceProbes mapRef={mapRef} mapReadyVersion={mapReadyVersion} />
    </div>
  )
}
