import { useEffect, useMemo } from 'react'

import config from '@/core/config'
import { useForecastSettings } from '@/forecast/settings'
import {
  useForecastRenderHost,
  type ForecastRenderLayerId,
} from '@/forecast/render'
import { useForecastSelectionContext } from '@/forecast/selection'
import {
  useForecastSync,
  type ForecastSyncInitialStatus,
} from '@/forecast/sync'
import {
  createForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import { useMapLibre } from '@/map/view/useMapLibre'
import { useForecastBasemapTheme } from '@/map/view/useForecastBasemapTheme'

export type UseForecastMapRuntimeArgs = {
  containerId?: string
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
  onFieldLoadingChange?: (isLoading: boolean) => void
}

export function useForecastMapRuntime({
  containerId = 'map',
  onInitialSyncStatusChange,
  onFieldLoadingChange,
}: UseForecastMapRuntimeArgs = {}) {
  const {
    map,
    mapError,
    retryMap,
  } = useMapLibre({
    containerId,
    center: [-100, 35],
    zoom: 3,
    minZoom: 2,
    maxZoom: 10,
  })
  const { selectedLayerId } = useForecastSelectionContext()
  const probeFrameChannel = useMemo(() => createForecastPlaceProbeFrameChannel(), [])
  const { settings } = useForecastSettings()
  const particlesActive = settings.particles.enabled
  const pressureContoursActive = settings.pressureContours.enabled

  const renderSettings = useMemo(() => {
    return {
      raster: { ...settings.raster },
      particles: settings.particles,
    }
  }, [settings])

  const renderProfile = useMemo(() => {
    const layerIds: ForecastRenderLayerId[] = ['raster', 'overlay']
    if (pressureContoursActive) layerIds.push('contour')
    if (particlesActive) layerIds.push('particles')

    return { layerIds }
  }, [particlesActive, pressureContoursActive])

  const syncOptions = useMemo(() => ({
    contour: pressureContoursActive,
    particles: particlesActive,
  }), [particlesActive, pressureContoursActive])

  const renderHost = useForecastRenderHost({
    map,
    profile: renderProfile,
    renderSettings,
  })

  useForecastBasemapTheme({
    map,
    selectedLayerId,
  })

  const { initialStatus } = useForecastSync({
    renderHost,
    config,
    syncOptions,
    onProbeFrameChange: probeFrameChannel.publish,
    onFieldLoadingChange,
  })
  useEffect(() => {
    onInitialSyncStatusChange?.(
      mapError == null
        ? initialStatus
        : {
            phase: 'error',
            errorMessage: mapError.message,
            retry: retryMap,
          },
    )
  }, [initialStatus, mapError, onInitialSyncStatusChange, retryMap])

  useEffect(() => {
    return () => {
      onInitialSyncStatusChange?.(null)
    }
  }, [onInitialSyncStatusChange])

  return {
    map,
    probeFrameChannel,
  }
}
