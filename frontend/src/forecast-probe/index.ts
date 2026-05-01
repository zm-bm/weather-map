import { useForecastProbeValueFormatter } from './display'
import {
  clearForecastProbeFrame,
  getForecastProbeFrame,
  setForecastProbeFrame,
  subscribeForecastProbeFrame,
} from './frame'
import {
  createScalarProbeSampler,
  sampleScalarFrameWindowWithSampler,
} from './scalar'

export { useForecastProbeValueFormatter }
export type { ForecastProbeValueDisplay } from './display'
export type { ScalarProbeSampler } from './scalar'

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
