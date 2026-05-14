import type {
  FieldFrameData,
  FieldFrameWindowData,
} from '../../forecast-frame'
import {
  layerProbe,
  type ForecastProbeValueDisplay,
  type LayerProbeSampler,
} from '../../forecast-probe'
import type { MapSelectedPlace } from '../../map/place-selection'
import type { PlaceProbeValueLabel } from '../../map/view/placeProbeLayer'

export type PlaceProbeLayerSamplers = {
  frameGridKey: string | null
  placeKey: string
  samplers: Array<LayerProbeSampler | null>
}

type ForecastProbeValueFormatter = (
  rawProbeValue: number | null,
  loading?: boolean
) => Pick<ForecastProbeValueDisplay, 'text'>

export function refreshLayerPlaceProbeSamplers(
  frame: FieldFrameWindowData | null,
  places: MapSelectedPlace[],
  previousSamplers?: PlaceProbeLayerSamplers,
  force = false,
): PlaceProbeLayerSamplers {
  const placeKey = getPlaceProbeKey(places)

  if (frame == null) {
    return {
      frameGridKey: null,
      placeKey,
      samplers: [],
    }
  }

  const frameGridKey = getFieldFrameGridKey(frame.lower)
  if (
    !force &&
    previousSamplers?.frameGridKey === frameGridKey &&
    previousSamplers.placeKey === placeKey
  ) {
    return previousSamplers
  }

  return {
    frameGridKey,
    placeKey,
    samplers: places.map((place) => layerProbe.createPointSampler(frame.lower, place)),
  }
}

export function createLayerPlaceProbeValueLabels(
  places: MapSelectedPlace[],
  frame: FieldFrameWindowData | null,
  samplerState: PlaceProbeLayerSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): PlaceProbeValueLabel[] {
  return places.map((place, index) => ({
    id: place.id,
    name: place.name,
    localName: place.localName,
    lon: place.lon,
    lat: place.lat,
    sortKey: place.sortKey,
    probeText: getLayerPlaceProbeText(index, frame, samplerState, formatProbeValue),
  }))
}

function getPlaceProbeKey(places: MapSelectedPlace[]): string {
  return places.map((place) => place.id).join('|')
}

function getLayerPlaceProbeText(
  placeIndex: number,
  frame: FieldFrameWindowData | null,
  samplerState: PlaceProbeLayerSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): string {
  const sampler = samplerState.samplers[placeIndex]
  const rawValue = frame != null && sampler != null
    ? layerProbe.sampleFrameWindowWithSampler(frame, sampler)
    : null

  return formatProbeValue(rawValue, frame == null).text
}

function getFieldFrameGridKey(frame: FieldFrameData): string {
  const { grid } = frame
  return [
    grid.nx,
    grid.ny,
    grid.lon0,
    grid.lat0,
    grid.dx,
    grid.dy,
    grid.xWrap,
    grid.yMode,
  ].join(':')
}
