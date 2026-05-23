import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  getPlaceProbeKey,
  selectVisiblePlaceProbes,
  type PlaceProbe,
} from './places'
import type { ForecastPlaceProbeFrame } from './frameChannel'
import {
  forecastPlaceProbeLayer,
  type PlaceProbeLabelSnapshot,
} from './layer'
import { createForecastPlaceProbeHoverSession } from './hover'
import {
  createPlaceProbeLabels,
  refreshPlaceProbeSamplers,
  type PlaceProbeSamplers,
} from './labels'
import type { ForecastPlaceProbeValueFormatter } from './types'

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
  let latestFrame = initialFrame
  let currentFrame: ForecastPlaceProbeFrame = null
  let visiblePlaces: PlaceProbe[] = []
  let visiblePlaceKey = ''
  let samplerState: PlaceProbeSamplers = refreshPlaceProbeSamplers(null, [])
  let labelsByPlaceId: PlaceProbeLabelSnapshot = new Map()
  let pendingSourceUpdateId: number | null = null
  let needsFullSourceUpdate = true
  let refreshOnNextIdle = false
  const hoverSession = createForecastPlaceProbeHoverSession(map)

  const rebuildSamplers = (force: boolean) => {
    samplerState = refreshPlaceProbeSamplers(
      currentFrame,
      visiblePlaces,
      samplerState,
      force,
    )
  }

  const updateSourceData = () => {
    pendingSourceUpdateId = null
    const labels = createPlaceProbeLabels(
      visiblePlaces,
      currentFrame,
      samplerState,
      formatProbeValue,
    )

    if (needsFullSourceUpdate) {
      labelsByPlaceId = labelsByPlaceId.size === 0
        ? forecastPlaceProbeLayer.setLabels(map, labels)
        : forecastPlaceProbeLayer.updateLabels(map, labels, labelsByPlaceId)
      needsFullSourceUpdate = false
      return
    }

    labelsByPlaceId = forecastPlaceProbeLayer.updateLabels(
      map,
      labels,
      labelsByPlaceId,
    )
  }

  const scheduleSourceUpdate = () => {
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

  const applyFrame = (frame: ForecastPlaceProbeFrame) => {
    currentFrame = frame?.lower.layerId === selectedLayerId ? frame : null
    rebuildSamplers(false)
    scheduleSourceUpdate()
  }

  const setFrame = (frame: ForecastPlaceProbeFrame) => {
    latestFrame = frame
    applyFrame(frame)
  }

  const refreshPlaces = (followUpOnIdle = false) => {
    refreshOnNextIdle = false
    const selectionContext = forecastPlaceProbeLayer.getSelectionContext(map)
    const nextVisiblePlaces = selectVisiblePlaceProbes(
      forecastPlaceProbeLayer.queryBasemapPlaces(map),
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

  return {
    start() {
      if (started) return

      started = true
      forecastPlaceProbeLayer.ensure(map)
      hoverSession.start()
      map.on('moveend', handleViewportSettled)
      map.on('resize', handleViewportSettled)
      map.on('idle', handleIdle)

      applyFrame(latestFrame)
      refreshPlaces(true)
    },

    destroy() {
      if (pendingSourceUpdateId != null) {
        window.cancelAnimationFrame(pendingSourceUpdateId)
        pendingSourceUpdateId = null
      }

      if (started) {
        map.off('moveend', handleViewportSettled)
        map.off('resize', handleViewportSettled)
        map.off('idle', handleIdle)
        hoverSession.destroy()
        forecastPlaceProbeLayer.remove(map)
      }

      started = false
      currentFrame = null
      visiblePlaces = []
      visiblePlaceKey = ''
      samplerState = refreshPlaceProbeSamplers(null, [])
      labelsByPlaceId.clear()
      refreshOnNextIdle = false
      needsFullSourceUpdate = true
    },

    setLayerId(nextLayerId) {
      if (selectedLayerId === nextLayerId) return
      selectedLayerId = nextLayerId
      applyFrame(latestFrame)
    },
    setValueFormatter(nextValueFormatter) {
      if (formatProbeValue === nextValueFormatter) return
      formatProbeValue = nextValueFormatter
      scheduleSourceUpdate()
    },
    setFrame,
  }
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
