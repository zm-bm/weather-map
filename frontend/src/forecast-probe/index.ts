import { useForecastProbeValueFormatter } from './display'
import {
  clearForecastProbeFrame,
  getForecastProbeFrame,
  setForecastProbeFrame,
  subscribeForecastProbeFrame,
} from './frame'
import { forecastProbePlaces } from './places'
import {
  createScalarProbeSampler,
  sampleScalarFrameWindowWithSampler,
} from './scalar'

export { forecastProbePlaces, useForecastProbeValueFormatter }
export type {
  ForecastProbePlace,
  ForecastProbePlaceBounds,
  ForecastProbePlaceScalarSamplers,
  ForecastProbePlaceValueLabel,
  SelectForecastProbePlacesOptions,
} from './places'

export const forecastProbeFrameStore = {
  publish: setForecastProbeFrame,
  getCurrent: getForecastProbeFrame,
  subscribe: subscribeForecastProbeFrame,
  clear: clearForecastProbeFrame,
} as const

export const scalarProbe = {
  createPointSampler: createScalarProbeSampler,
  sampleFrameWindowWithSampler: sampleScalarFrameWindowWithSampler,
} as const
