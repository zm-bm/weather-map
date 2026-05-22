import { useEffect, useMemo } from 'react'

import config from '../../config'
import {
  type ForecastRenderSettings,
  type ForecastSettings,
  useForecastSettings,
} from '../../forecast-settings'
import {
  useForecastRenderHost,
  type ForecastRendererId,
  type ForecastRenderProfile,
} from '../../forecast-render'
import { useForecastSelectionContext } from '../../forecast-selection'
import { useForecastSync, type ForecastSyncStartupStatus } from '../../forecast-sync'
import { useMap } from '../../map/useMap'
import { useForecastBasemapTheme } from '../../map/view/useForecastBasemapTheme'
import ForecastPlaceProbes from '../ForecastPlaceProbes'
import MapControlRail from '../MapControlRail'

export type ForecastMapProps = {
  containerId?: string
  onSyncStartupStatusChange?: (status: ForecastSyncStartupStatus | null) => void
}

export default function ForecastMap({
  containerId = 'map',
  onSyncStartupStatusChange,
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMap({ containerId })
  const { selectedLayerId } = useForecastSelectionContext()

  const {
    settings,
    actions,
  } = useForecastSettings()

  const renderSettings = useMemo(
    () => createRenderSettings(settings),
    [settings],
  )

  const renderProfile = useMemo(
    () => createRenderProfile(settings),
    [settings],
  )

  const renderHost = useForecastRenderHost({
    getMap,
    mapReadyVersion,
    profile: renderProfile,
    renderSettings,
  })

  useForecastBasemapTheme({
    getMap,
    mapReadyVersion,
    selectedLayerId,
  })

  const { startupStatus } = useForecastSync({
    renderHost,
    config,
    pressureContoursEnabled: settings.pressureContours.enabled,
  })

  useEffect(() => {
    onSyncStartupStatusChange?.(startupStatus)
  }, [onSyncStartupStatusChange, startupStatus])

  useEffect(() => {
    return () => {
      onSyncStartupStatusChange?.(null)
    }
  }, [onSyncStartupStatusChange])

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
      <MapControlRail
        mapRef={mapRef}
        mapReadyVersion={mapReadyVersion}
        settings={settings}
        settingsActions={actions}
      />
      <ForecastPlaceProbes mapRef={mapRef} mapReadyVersion={mapReadyVersion} />
    </div>
  )
}

function createRenderProfile(settings: ForecastSettings): ForecastRenderProfile {
  const rendererIds: ForecastRendererId[] = ['field', 'cloud-layers', 'field-overlay']
  if (settings.pressureContours.enabled) rendererIds.push('contour-overlay')
  if (settings.particles.enabled) rendererIds.push('particles')

  return { rendererIds }
}

function createRenderSettings(settings: ForecastSettings): ForecastRenderSettings {
  return {
    field: {
      ...settings.field,
    },
    particles: createParticleRenderSettings(settings.particles),
  }
}

function createParticleRenderSettings({
  enabled,
  ...settings
}: ForecastSettings['particles']): ForecastRenderSettings['particles'] {
  void enabled
  return settings
}
