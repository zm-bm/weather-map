import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  getPlaceProbeKey,
  selectVisiblePlaceProbes,
  type PlaceProbe,
} from './places'
import {
  getPlaceProbeZoomTier,
  type PlaceProbeZoomTier,
} from './candidates'
import type { ForecastPlaceProbeFrame } from './frameChannel'
import {
  ensurePlaceProbeLayer,
  getPaddedPlaceProbeBounds,
  getPlaceProbeBounds,
  getPlaceProbeViewportSize,
  queryBasemapPlaceFeatures,
  removePlaceProbeLayer,
  setPlaceProbeLabels,
} from './layer'
import { createPlaceProbeHoverSession } from './hover'
import {
  createPlaceProbeLabels,
  refreshPlaceProbeSamplers,
  type ForecastPlaceProbeValueFormatter,
  type PlaceProbeSamplers,
} from './labels'

export type ForecastPlaceProbeSession = {
  start: () => void
  destroy: () => void
  setFrame: (frame: ForecastPlaceProbeFrame) => void
}

export type ForecastPlaceProbeSessionOptions = {
  map: MapLibreMap
  layerId: string
  valueFormatter: ForecastPlaceProbeValueFormatter
}

export function createForecastPlaceProbeSession({
  map,
  layerId,
  valueFormatter,
}: ForecastPlaceProbeSessionOptions): ForecastPlaceProbeSession {
  let started = false
  let latestPublishedFrame: ForecastPlaceProbeFrame = null
  let probeableFrame: ForecastPlaceProbeFrame = null
  let visiblePlaces: PlaceProbe[] = []
  let visiblePlaceKey = ''
  let visiblePlaceZoomTier: PlaceProbeZoomTier | null = null
  let samplerState: PlaceProbeSamplers = refreshPlaceProbeSamplers(null, [])
  let pendingSourceUpdateId: number | null = null
  let refreshOnNextIdle = false
  const hoverSession = createPlaceProbeHoverSession(map)

  const rebuildSamplers = (force: boolean) => {
    samplerState = refreshPlaceProbeSamplers(
      probeableFrame,
      visiblePlaces,
      samplerState,
      force,
    )
  }

  const updateSourceData = () => {
    pendingSourceUpdateId = null
    const labels = createPlaceProbeLabels(
      visiblePlaces,
      probeableFrame,
      samplerState,
      valueFormatter,
    )
    setPlaceProbeLabels(map, labels)
  }

  const scheduleSourceUpdate = () => {
    if (!started) return
    if (pendingSourceUpdateId != null) return
    pendingSourceUpdateId = window.requestAnimationFrame(updateSourceData)
  }

  const replaceVisiblePlaces = (
    nextVisiblePlaces: PlaceProbe[],
    nextZoomTier: PlaceProbeZoomTier,
  ) => {
    const nextVisiblePlaceKey = getPlaceProbeKey(nextVisiblePlaces)
    if (visiblePlaceKey === nextVisiblePlaceKey) {
      visiblePlaceZoomTier = nextZoomTier
      return false
    }

    visiblePlaces = nextVisiblePlaces
    visiblePlaceKey = nextVisiblePlaceKey
    visiblePlaceZoomTier = nextZoomTier
    return true
  }

  const applyLatestPublishedFrame = () => {
    probeableFrame = probeFrameForSelectedLayer(latestPublishedFrame, layerId)
    rebuildSamplers(false)
    scheduleSourceUpdate()
  }

  const setFrame = (frame: ForecastPlaceProbeFrame) => {
    latestPublishedFrame = frame
    applyLatestPublishedFrame()
  }

  const refreshPlaces = (followUpOnIdle = false) => {
    refreshOnNextIdle = false
    const zoom = map.getZoom()
    const zoomTier = getPlaceProbeZoomTier(zoom)
    const visibleBounds = getPlaceProbeBounds(map)
    const nextVisiblePlaces = selectVisiblePlaceProbes(
      queryBasemapPlaceFeatures(map),
      {
        zoom,
        bounds: getPaddedPlaceProbeBounds(map),
        gridBounds: visibleBounds,
        viewportSize: getPlaceProbeViewportSize(map),
        previousPlaces: visiblePlaceZoomTier === zoomTier ? visiblePlaces : [],
      },
    )
    if (shouldDeferProvisionalPlaceRefresh(followUpOnIdle, visiblePlaces, nextVisiblePlaces)) {
      refreshOnNextIdle = true
      return
    }

    const didReplaceVisiblePlaces = replaceVisiblePlaces(nextVisiblePlaces, zoomTier)
    rebuildSamplers(didReplaceVisiblePlaces)
    scheduleSourceUpdate()
    refreshOnNextIdle = followUpOnIdle
  }

  const handleViewportSettled = () => {
    refreshPlaces(true)
  }

  const handleIdle = () => {
    if (!refreshOnNextIdle) return
    refreshPlaces(false)
  }

  const attachViewportListeners = () => {
    map.on('moveend', handleViewportSettled)
    map.on('resize', handleViewportSettled)
    map.on('idle', handleIdle)
  }

  const detachViewportListeners = () => {
    map.off('moveend', handleViewportSettled)
    map.off('resize', handleViewportSettled)
    map.off('idle', handleIdle)
  }

  const destroySession = () => {
    if (pendingSourceUpdateId != null) {
      window.cancelAnimationFrame(pendingSourceUpdateId)
      pendingSourceUpdateId = null
    }

    if (started) {
      detachViewportListeners()
      hoverSession.destroy()
      removePlaceProbeLayer(map)
    }

    started = false
    probeableFrame = null
    visiblePlaces = []
    visiblePlaceKey = ''
    visiblePlaceZoomTier = null
    samplerState = refreshPlaceProbeSamplers(null, [])
    refreshOnNextIdle = false
  }

  return {
    start() {
      if (started) return

      try {
        ensurePlaceProbeLayer(map)
        hoverSession.start()
        attachViewportListeners()
      } catch (error) {
        detachViewportListeners()
        hoverSession.destroy()
        removePlaceProbeLayer(map)
        throw error
      }

      started = true
      try {
        applyLatestPublishedFrame()
        refreshPlaces(true)
      } catch (error) {
        destroySession()
        throw error
      }
    },

    destroy: destroySession,

    setFrame,
  }
}

function probeFrameForSelectedLayer(
  frame: ForecastPlaceProbeFrame,
  selectedLayerId: string,
): ForecastPlaceProbeFrame {
  return frame?.lower.source.layerId === selectedLayerId ? frame : null
}

function shouldDeferProvisionalPlaceRefresh(
  followUpOnIdle: boolean,
  currentPlaces: PlaceProbe[],
  nextPlaces: PlaceProbe[],
): boolean {
  return followUpOnIdle &&
    currentPlaces.length > 0 &&
    nextPlaces.length < currentPlaces.length
}
