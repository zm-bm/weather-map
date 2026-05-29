export type ForecastRenderLayerId = 'raster' | 'overlay' | 'contour' | 'particles'

export type ForecastRenderProfile = {
  layerIds: readonly ForecastRenderLayerId[]
}
