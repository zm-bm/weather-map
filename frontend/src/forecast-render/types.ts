import type { ForecastRenderData } from '../forecast-data'

export type ForecastRenderHost = {
  version: number
  apply: (data: ForecastRenderData) => void
}

export type ForecastRendererId = 'field' | 'cloud-layers' | 'field-overlay' | 'contour-overlay' | 'particles'

export type ForecastRenderProfile = {
  rendererIds: readonly ForecastRendererId[]
}
