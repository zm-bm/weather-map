import type { ProbeWindow } from '@/forecast/frames'
import {
  createRasterProbeSampler,
  sampleRasterWindowWithSampler,
  type RasterProbeSampler,
} from './rasterSampling'
import { getPlaceProbeKey, type PlaceProbe } from './places'
import type { PlaceProbeValueLabel } from './layer'

export type ForecastPlaceProbeValueFormatter = (
  rawProbeValue: number | null,
  loading?: boolean
) => { text: string }

export type PlaceProbeSamplers = {
  frameGridKey: string | null
  placeKey: string
  samplers: Array<RasterProbeSampler | null>
}

export function refreshPlaceProbeSamplers(
  frame: ProbeWindow | null,
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

  const frameGridKey = getRasterFrameGridKey(frame.lower)
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
    samplers: places.map((place) => createRasterProbeSampler(frame.lower, place)),
  }
}

export function createPlaceProbeLabels(
  places: PlaceProbe[],
  frame: ProbeWindow | null,
  samplerState: PlaceProbeSamplers,
  formatProbeValue: ForecastPlaceProbeValueFormatter,
): PlaceProbeValueLabel[] {
  return places.map((place, index) => {
    const rawProbeValue = getPlaceProbeValue(index, frame, samplerState)
    const probeText = frame == null ? '' : formatProbeValue(rawProbeValue).text
    return {
      id: place.id,
      lon: place.lon,
      lat: place.lat,
      sortKey: place.sortKey,
      labelText: [place.name, place.localName, probeText].filter(Boolean).join('\n'),
    }
  })
}

function getPlaceProbeValue(
  placeIndex: number,
  frame: ProbeWindow | null,
  samplerState: PlaceProbeSamplers,
): number | null {
  const sampler = samplerState.samplers[placeIndex]
  const rawValue = frame != null && sampler != null
    ? sampleRasterWindowWithSampler(frame, sampler)
    : null

  return rawValue != null && Number.isFinite(rawValue) ? rawValue : null
}

function getRasterFrameGridKey(frame: ProbeWindow['lower']): string {
  const { grid } = frame.raster
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
