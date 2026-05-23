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
import type { ForecastProductOptions } from '../../forecast-products'
import { useForecastSelectionContext } from '../../forecast-selection'
import { useForecastSync, type ForecastSyncStartupStatus } from '../../forecast-sync'
import { createForecastPlaceProbeFrameChannel } from '../../forecast-place-probes'
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

  const productOptions = useMemo(
    () => createProductOptions({ particlesEnabled, pressureContoursEnabled }),
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

  const { startupStatus } = useForecastSync({
    renderHost,
    config,
    productOptions,
    onProbeFrameChange: probeFrameChannel.publish,
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
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={mapReadyVersion}
        probeFrameChannel={probeFrameChannel}
      />
    </div>
  )
}

type ProductFeatureFlags = {
  particlesEnabled: boolean
  pressureContoursEnabled: boolean
}

function createRenderProfile({
  particlesEnabled,
  pressureContoursEnabled,
}: ProductFeatureFlags): ForecastRenderProfile {
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

function createProductOptions({
  particlesEnabled,
  pressureContoursEnabled,
}: ProductFeatureFlags): ForecastProductOptions {
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
