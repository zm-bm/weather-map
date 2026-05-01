import type {
  ScalarFrameData,
  ScalarFrameWindowData,
} from '../../forecast-frame/scalar'
import {
  scalarProbe,
  type ForecastProbeValueDisplay,
  type ScalarProbeSampler,
} from '../../forecast-probe'
import type { MapSelectedPlace } from '../../map/place-selection'
import type { PlaceProbeValueLabel } from '../../map/view/placeProbeLayer'

export type PlaceProbeScalarSamplers = {
  frameGridKey: string | null
  placeKey: string
  samplers: Array<ScalarProbeSampler | null>
}

type ForecastProbeValueFormatter = (
  rawProbeValue: number | null,
  loading?: boolean
) => Pick<ForecastProbeValueDisplay, 'text'>

export function refreshScalarPlaceProbeSamplers(
  frame: ScalarFrameWindowData | null,
  places: MapSelectedPlace[],
  previousSamplers?: PlaceProbeScalarSamplers,
  force = false,
): PlaceProbeScalarSamplers {
  const placeKey = getPlaceProbeKey(places)

  if (frame == null) {
    return {
      frameGridKey: null,
      placeKey,
      samplers: [],
    }
  }

  const frameGridKey = getScalarFrameGridKey(frame.lower)
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
    samplers: places.map((place) => scalarProbe.createPointSampler(frame.lower, place)),
  }
}

export function createScalarPlaceProbeValueLabels(
  places: MapSelectedPlace[],
  frame: ScalarFrameWindowData | null,
  samplerState: PlaceProbeScalarSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): PlaceProbeValueLabel[] {
  return places.map((place, index) => ({
    id: place.id,
    name: place.name,
    localName: place.localName,
    lon: place.lon,
    lat: place.lat,
    sortKey: place.sortKey,
    probeText: getScalarPlaceProbeText(index, frame, samplerState, formatProbeValue),
  }))
}

function getPlaceProbeKey(places: MapSelectedPlace[]): string {
  return places.map((place) => place.id).join('|')
}

function getScalarPlaceProbeText(
  placeIndex: number,
  frame: ScalarFrameWindowData | null,
  samplerState: PlaceProbeScalarSamplers,
  formatProbeValue: ForecastProbeValueFormatter,
): string {
  const sampler = samplerState.samplers[placeIndex]
  const rawValue = frame != null && sampler != null
    ? scalarProbe.sampleFrameWindowWithSampler(frame, sampler)
    : null

  return formatProbeValue(rawValue, frame == null).text
}

function getScalarFrameGridKey(frame: ScalarFrameData): string {
  const { grid } = frame
  return [
    grid.nx,
    grid.ny,
    grid.lon0,
    grid.lat0,
    grid.dx,
    grid.dy,
    grid.x_wrap,
    grid.y_mode,
  ].join(':')
}
