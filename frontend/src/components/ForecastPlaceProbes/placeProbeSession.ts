import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  forecastFieldDataStore,
} from '../../forecast-probe'
import type { FieldInterpolationWindowData } from '../../forecast-data'
import {
  mapPlaceSelection,
  type MapSelectedPlace,
} from '../../map/place-selection'
import {
  mapPlaceProbeLayer,
  type PlaceProbeLabelSnapshot,
} from '../../map/view/placeProbeLayer'
import {
  createLayerPlaceProbeValueLabels,
  refreshLayerPlaceProbeSamplers,
  type PlaceProbeLayerSamplers,
} from './placeProbeValues'

type ProbeValueFormatter = (
  rawProbeValue: number | null,
  loading?: boolean
) => { text: string }

export type PlaceProbeSession = {
  start: () => void
  destroy: () => void
  refreshFrame: () => void
}

type PlaceProbeSessionOptions = {
  map: MapLibreMap
  getSelectedLayerId: () => string
  getValueFormatter: () => ProbeValueFormatter
}

export function createPlaceProbeSession({
  map,
  getSelectedLayerId,
  getValueFormatter,
}: PlaceProbeSessionOptions): PlaceProbeSession {
  let started = false
  let currentFrame: FieldInterpolationWindowData | null = null
  let visiblePlaces: MapSelectedPlace[] = []
  let visiblePlaceKey = ''
  let samplerState: PlaceProbeLayerSamplers = refreshLayerPlaceProbeSamplers(null, [])
  let labelsByPlaceId: PlaceProbeLabelSnapshot = new Map()
  let pendingSourceUpdateId: number | null = null
  let needsFullSourceUpdate = true
  let refreshOnNextIdle = false
  let unsubscribeFrameStore: (() => void) | null = null

  const rebuildSamplers = (force: boolean) => {
    samplerState = refreshLayerPlaceProbeSamplers(
      currentFrame,
      visiblePlaces,
      samplerState,
      force,
    )
  }

  const updateSourceData = () => {
    pendingSourceUpdateId = null
    const labels = createLayerPlaceProbeValueLabels(
      visiblePlaces,
      currentFrame,
      samplerState,
      getValueFormatter(),
    )

    if (needsFullSourceUpdate) {
      labelsByPlaceId = labelsByPlaceId.size === 0
        ? mapPlaceProbeLayer.setLabels(map, labels)
        : mapPlaceProbeLayer.updateLabels(map, labels, labelsByPlaceId)
      needsFullSourceUpdate = false
      return
    }

    labelsByPlaceId = mapPlaceProbeLayer.updateLabels(
      map,
      labels,
      labelsByPlaceId,
    )
  }

  const scheduleSourceUpdate = () => {
    if (pendingSourceUpdateId != null) return
    pendingSourceUpdateId = window.requestAnimationFrame(updateSourceData)
  }

  const replaceVisiblePlaces = (nextVisiblePlaces: MapSelectedPlace[]) => {
    const nextVisiblePlaceKey = mapPlaceSelection.getKey(nextVisiblePlaces)
    if (visiblePlaceKey === nextVisiblePlaceKey) return false

    visiblePlaces = nextVisiblePlaces
    visiblePlaceKey = nextVisiblePlaceKey
    needsFullSourceUpdate = true
    return true
  }

  const setFrame = (frame: FieldInterpolationWindowData | null) => {
    currentFrame = frame?.lower.layerId === getSelectedLayerId() ? frame : null
    rebuildSamplers(false)
    scheduleSourceUpdate()
  }

  const refreshFrame = () => {
    setFrame(forecastFieldDataStore.getCurrent())
  }

  const refreshPlaces = (followUpOnIdle = false) => {
    refreshOnNextIdle = false
    const selectionContext = mapPlaceProbeLayer.getSelectionContext(map)
    const nextVisiblePlaces = mapPlaceSelection.selectVisible(
      mapPlaceProbeLayer.queryBasemapPlaces(map),
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
      mapPlaceProbeLayer.ensure(map)
      map.on('moveend', handleViewportSettled)
      map.on('resize', handleViewportSettled)
      map.on('idle', handleIdle)
      unsubscribeFrameStore = forecastFieldDataStore.subscribe(setFrame)

      refreshFrame()
      refreshPlaces(true)
    },

    destroy() {
      if (pendingSourceUpdateId != null) {
        window.cancelAnimationFrame(pendingSourceUpdateId)
        pendingSourceUpdateId = null
      }

      unsubscribeFrameStore?.()
      unsubscribeFrameStore = null

      if (started) {
        map.off('moveend', handleViewportSettled)
        map.off('resize', handleViewportSettled)
        map.off('idle', handleIdle)
        mapPlaceProbeLayer.remove(map)
      }

      started = false
      currentFrame = null
      visiblePlaces = []
      visiblePlaceKey = ''
      samplerState = refreshLayerPlaceProbeSamplers(null, [])
      labelsByPlaceId.clear()
      refreshOnNextIdle = false
      needsFullSourceUpdate = true
    },

    refreshFrame,
  }
}

function shouldDeferProvisionalPlaceRefresh(
  followUpOnIdle: boolean,
  currentPlaces: MapSelectedPlace[],
  nextPlaces: MapSelectedPlace[],
): boolean {
  return followUpOnIdle &&
    currentPlaces.length > 0 &&
    nextPlaces.length < currentPlaces.length
}
