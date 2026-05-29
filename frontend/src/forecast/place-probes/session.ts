import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  getPlaceProbeKey,
  selectVisiblePlaceProbes,
  type PlaceProbe,
} from './places'
import type { ForecastPlaceProbeFrame } from './frameChannel'
import {
  ensurePlaceProbeLayer,
  getPlaceProbeSelectionContext,
  queryBasemapPlaceFeatures,
  removePlaceProbeLayer,
  setPlaceProbeLabels,
  updatePlaceProbeLabels,
  type PlaceProbeLabelSnapshot,
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
  setLayerId: (layerId: string) => void
  setValueFormatter: (valueFormatter: ForecastPlaceProbeValueFormatter) => void
  setFrame: (frame: ForecastPlaceProbeFrame) => void
}

export type ForecastPlaceProbeSessionOptions = {
  map: MapLibreMap
  layerId: string
  valueFormatter: ForecastPlaceProbeValueFormatter
  initialFrame: ForecastPlaceProbeFrame
}

export function createForecastPlaceProbeSession({
  map,
  layerId,
  valueFormatter,
  initialFrame,
}: ForecastPlaceProbeSessionOptions): ForecastPlaceProbeSession {
  let started = false
  let selectedLayerId = layerId
  let formatProbeValue = valueFormatter
  let latestPublishedFrame = initialFrame
  let probeableFrame: ForecastPlaceProbeFrame = null
  let visiblePlaces: PlaceProbe[] = []
  let visiblePlaceKey = ''
  let samplerState: PlaceProbeSamplers = refreshPlaceProbeSamplers(null, [])
  let labelsByPlaceId: PlaceProbeLabelSnapshot = new Map()
  let pendingSourceUpdateId: number | null = null
  let needsFullSourceUpdate = true
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
      formatProbeValue,
    )

    if (needsFullSourceUpdate) {
      labelsByPlaceId = labelsByPlaceId.size === 0
        ? setPlaceProbeLabels(map, labels)
        : updatePlaceProbeLabels(map, labels, labelsByPlaceId)
      needsFullSourceUpdate = false
      return
    }

    labelsByPlaceId = updatePlaceProbeLabels(
      map,
      labels,
      labelsByPlaceId,
    )
  }

  const scheduleSourceUpdate = () => {
    if (!started) return
    if (pendingSourceUpdateId != null) return
    pendingSourceUpdateId = window.requestAnimationFrame(updateSourceData)
  }

  const replaceVisiblePlaces = (nextVisiblePlaces: PlaceProbe[]) => {
    const nextVisiblePlaceKey = getPlaceProbeKey(nextVisiblePlaces)
    if (visiblePlaceKey === nextVisiblePlaceKey) return false

    visiblePlaces = nextVisiblePlaces
    visiblePlaceKey = nextVisiblePlaceKey
    needsFullSourceUpdate = true
    return true
  }

  const applyLatestPublishedFrame = () => {
    probeableFrame = probeFrameForSelectedLayer(latestPublishedFrame, selectedLayerId)
    rebuildSamplers(false)
    scheduleSourceUpdate()
  }

  const setFrame = (frame: ForecastPlaceProbeFrame) => {
    latestPublishedFrame = frame
    applyLatestPublishedFrame()
  }

  const refreshPlaces = (followUpOnIdle = false) => {
    refreshOnNextIdle = false
    const selectionContext = getPlaceProbeSelectionContext(map)
    const nextVisiblePlaces = selectVisiblePlaceProbes(
      queryBasemapPlaceFeatures(map),
      {
        zoom: map.getZoom(),
        bounds: selectionContext.bounds,
        project: selectionContext.project,
        previousPlaces: visiblePlaces,
      },
    )
    if (shouldDeferProvisionalPlaceRefresh(followUpOnIdle, visiblePlaces, nextVisiblePlaces)) {
      refreshOnNextIdle = true
      return
    }

    const didReplaceVisiblePlaces = replaceVisiblePlaces(nextVisiblePlaces)
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
    samplerState = refreshPlaceProbeSamplers(null, [])
    labelsByPlaceId.clear()
    refreshOnNextIdle = false
    needsFullSourceUpdate = true
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

    setLayerId(nextLayerId) {
      if (selectedLayerId === nextLayerId) return
      selectedLayerId = nextLayerId
      applyLatestPublishedFrame()
    },
    setValueFormatter(nextValueFormatter) {
      if (formatProbeValue === nextValueFormatter) return
      formatProbeValue = nextValueFormatter
      scheduleSourceUpdate()
    },
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
