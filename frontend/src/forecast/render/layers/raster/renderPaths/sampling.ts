import type { RasterGridSamplingMode } from '@/forecast/settings/settings'

export const RASTER_SOURCE_SAMPLING_MODE_BILINEAR = 0
export const RASTER_SOURCE_SAMPLING_MODE_NEAREST = 1

export function rasterSourceSamplingModeUniform(gridSamplingMode: RasterGridSamplingMode): number {
  return gridSamplingMode === 'nearest'
    ? RASTER_SOURCE_SAMPLING_MODE_NEAREST
    : RASTER_SOURCE_SAMPLING_MODE_BILINEAR
}
