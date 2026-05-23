import type {
  FieldTimeSliceData,
  FieldInterpolationWindowData,
} from '../forecast-data'
import {
  layerProbe,
  type ForecastProbeValueDisplay,
  type LayerProbeSampler,
} from '../forecast-probe'
import { getPlaceProbeKey, type PlaceProbe } from './places'
import type { PlaceProbeValueLabel } from './layer'

export type PlaceProbeSamplers = {
  frameGridKey: string | null
  placeKey: string
  samplers: Array<LayerProbeSampler | null>
}

type ForecastProbeValueFormatter = (
  rawProbeValue: number | null,
  loading?: boolean
) => Pick<ForecastProbeValueDisplay, 'text'>

export function refreshPlaceProbeSamplers(
  frame: FieldInterpolationWindowData | null,
  places: PlaceProbe[],
  previousSamplers?: PlaceProbeSamplers,
  force = false,
): PlaceProbeSamplers {
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

export function createPlaceProbeLabels(
  places: PlaceProbe[],
  frame: FieldInterpolationWindowData | null,
  samplerState: PlaceProbeSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): PlaceProbeValueLabel[] {
  return places.map((place, index) => ({
    id: place.id,
    name: place.name,
    localName: place.localName,
    lon: place.lon,
    lat: place.lat,
    sortKey: place.sortKey,
    probeText: getPlaceProbeText(index, frame, samplerState, formatProbeValue),
  }))
}

function getPlaceProbeText(
  placeIndex: number,
  frame: FieldInterpolationWindowData | null,
  samplerState: PlaceProbeSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): string {
  const sampler = samplerState.samplers[placeIndex]
  const rawValue = frame != null && sampler != null
    ? layerProbe.sampleInterpolationWindowWithSampler(frame, sampler)
    : null

  return formatProbeValue(rawValue, frame == null).text
}

function getFieldFrameGridKey(frame: FieldTimeSliceData): string {
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
