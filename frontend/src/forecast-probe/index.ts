import { useForecastProbeValueFormatter } from './display'
import {
  clearForecastFieldData,
  getForecastFieldData,
  setForecastFieldData,
  subscribeForecastFieldData,
} from './frame'
import {
  createLayerProbeSampler,
  sampleFieldInterpolationWindowWithSampler,
} from './layer'

export { useForecastProbeValueFormatter }
export type { ForecastProbeValueDisplay } from './display'
export type { LayerProbeSampler } from './layer'

export const forecastFieldDataStore = {
  publish: setForecastFieldData,
  getCurrent: getForecastFieldData,
  subscribe: subscribeForecastFieldData,
  clear: clearForecastFieldData,
} as const

export const layerProbe = {
  createPointSampler: createLayerProbeSampler,
  sampleInterpolationWindowWithSampler: sampleFieldInterpolationWindowWithSampler,
} as const
