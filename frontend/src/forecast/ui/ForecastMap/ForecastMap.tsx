import { useEffect, useMemo } from 'react'

import config from '@/core/config'
import {
  type ForecastRenderSettings,
  type ForecastSettings,
  useForecastSettings,
} from '@/forecast/settings'
import {
  useForecastRenderHost,
  type ForecastRenderLayerId,
  type ForecastRenderProfile,
} from '@/forecast/render'
import { useForecastSelectionContext } from '@/forecast/selection'
import {
  useForecastSync,
  type ForecastSyncOptions,
  type ForecastSyncInitialStatus,
} from '@/forecast/sync'
import { createForecastPlaceProbeFrameChannel } from '@/forecast/place-probes'
import { useMap } from '@/map/useMap'
import { useForecastBasemapTheme } from '@/map/view/useForecastBasemapTheme'
import ForecastPlaceProbes from '../ForecastPlaceProbes'
import MapControlRail from '../MapControlRail'

export type ForecastMapProps = {
  containerId?: string
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
}

export default function ForecastMap({
  containerId = 'map',
  onInitialSyncStatusChange,
}: ForecastMapProps) {
  const { mapRef, getMap, mapReadyVersion } = useMap({ containerId })
  const { selectedLayerId } = useForecastSelectionContext()
  const probeFrameChannel = useMemo(() => createForecastPlaceProbeFrameChannel(), [])

  const {
    settings,
    actions,
  } = useForecastSettings()
  const particlesEnabled = settings.particles.enabled
  const pressureContoursEnabled = settings.pressureContours.enabled

  const renderSettings = useMemo(
    () => createRenderSettings(settings),
    [settings],
  )

  const renderProfile = useMemo(
    () => createRenderProfile({ particlesEnabled, pressureContoursEnabled }),
    [particlesEnabled, pressureContoursEnabled],
  )

  const syncOptions = useMemo(
    () => createSyncOptions({ particlesEnabled, pressureContoursEnabled }),
    [particlesEnabled, pressureContoursEnabled],
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

  const { initialStatus } = useForecastSync({
    renderHost,
    config,
    syncOptions,
    onProbeFrameChange: probeFrameChannel.publish,
  })

  useEffect(() => {
    onInitialSyncStatusChange?.(initialStatus)
  }, [onInitialSyncStatusChange, initialStatus])

  useEffect(() => {
    return () => {
      onInitialSyncStatusChange?.(null)
    }
  }, [onInitialSyncStatusChange])

  return (
    <div className="map-stage">
      <div id={containerId} className="map-stage__viewport" />
      <MapControlRail
        mapRef={mapRef}
        mapReadyVersion={mapReadyVersion}
        settings={settings}
        settingsActions={actions}
      />
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={mapReadyVersion}
        probeFrameChannel={probeFrameChannel}
      />
    </div>
  )
}

type ForecastFeatureFlags = {
  particlesEnabled: boolean
  pressureContoursEnabled: boolean
}

function createRenderProfile({
  particlesEnabled,
  pressureContoursEnabled,
}: ForecastFeatureFlags): ForecastRenderProfile {
  const layerIds: ForecastRenderLayerId[] = ['raster', 'overlay']
  if (pressureContoursEnabled) layerIds.push('contour')
  if (particlesEnabled) layerIds.push('particles')

  return { layerIds }
}

function createRenderSettings(settings: ForecastSettings): ForecastRenderSettings {
  return {
    raster: {
      ...settings.raster,
    },
    particles: createParticleRenderSettings(settings.particles),
  }
}

function createSyncOptions({
  particlesEnabled,
  pressureContoursEnabled,
}: ForecastFeatureFlags): ForecastSyncOptions {
  return {
    contour: pressureContoursEnabled,
    particles: particlesEnabled,
  }
}

function createParticleRenderSettings({
  enabled,
  ...settings
}: ForecastSettings['particles']): ForecastRenderSettings['particles'] {
  void enabled
  return settings
}
