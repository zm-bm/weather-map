import type { LoadedForecastProducts } from '../forecast-products'

export type ForecastRenderHost = {
  version: number
  apply: (data: LoadedForecastProducts) => void
}

export type ForecastRendererId = 'field' | 'cloud-layers' | 'field-overlay' | 'contour-overlay' | 'particles'

export type ForecastRenderProfile = {
  rendererIds: readonly ForecastRendererId[]
}
