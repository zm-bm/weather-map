import { useEffect, useMemo } from 'react'

import config from '@/core/config'
import {
  type ForecastRenderSettings,
  type ForecastSettings,
  useForecastSettings,
} from '@/forecast/settings'
import {
  useForecastRenderHost,
  type ForecastRendererId,
  type ForecastRenderProfile,
} from '@/forecast/render'
import type { ForecastDataOptions } from '@/forecast/data'
import { useForecastSelectionContext } from '@/forecast/selection'
import { useForecastSync, type ForecastSyncInitialStatus } from '@/forecast/sync'
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

  const dataOptions = useMemo(
    () => createDataOptions({ particlesEnabled, pressureContoursEnabled }),
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
    dataOptions,
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

type DataFeatureFlags = {
  particlesEnabled: boolean
  pressureContoursEnabled: boolean
}

function createRenderProfile({
  particlesEnabled,
  pressureContoursEnabled,
}: DataFeatureFlags): ForecastRenderProfile {
  const rendererIds: ForecastRendererId[] = ['field', 'cloud-layers', 'field-overlay']
  if (pressureContoursEnabled) rendererIds.push('contour-overlay')
  if (particlesEnabled) rendererIds.push('particles')

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

function createDataOptions({
  particlesEnabled,
  pressureContoursEnabled,
}: DataFeatureFlags): ForecastDataOptions {
  return {
    pressure: pressureContoursEnabled,
    windVectors: particlesEnabled,
  }
}

function createParticleRenderSettings({
  enabled,
  ...settings
}: ForecastSettings['particles']): ForecastRenderSettings['particles'] {
  void enabled
  return settings
}
