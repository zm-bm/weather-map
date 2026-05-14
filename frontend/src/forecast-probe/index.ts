import { useForecastProbeValueFormatter } from './display'
import {
  clearForecastFieldFrame,
  getForecastFieldFrame,
  setForecastFieldFrame,
  subscribeForecastFieldFrame,
} from './frame'
import {
  createLayerProbeSampler,
  sampleFieldFrameWindowWithSampler,
} from './layer'

export { useForecastProbeValueFormatter }
export type { ForecastProbeValueDisplay } from './display'
export type { LayerProbeSampler } from './layer'

export const forecastFieldFrameStore = {
  publish: setForecastFieldFrame,
  getCurrent: getForecastFieldFrame,
  subscribe: subscribeForecastFieldFrame,
  clear: clearForecastFieldFrame,
} as const

export const layerProbe = {
  createPointSampler: createLayerProbeSampler,
  sampleFrameWindowWithSampler: sampleFieldFrameWindowWithSampler,
} as const
