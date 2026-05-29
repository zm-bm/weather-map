import {
  hasExactBandIds,
  sourceBandIds,
} from '@/forecast/catalog/source'
import type { RasterWindow } from '@/forecast/frames'
import {
  getRasterPalette,
  samplePaletteColor,
} from '@/forecast/palette'
import {
  encodedRasterFrameSpec,
  type EncodedGridFrameSpec,
} from '../../../encodedGrid'

import { CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE } from './cloudLayersShaders'

export const CLOUD_LAYERS_RENDER_PATH_ID = 'cloud-layers'

type RasterFrame = RasterWindow['lower']

export type CloudLayerColorUniforms = {
  u_low_cloud_color: [number, number, number]
  u_middle_cloud_color: [number, number, number]
  u_high_cloud_color: [number, number, number]
}

export function isCloudLayersRasterFrame(frame: RasterFrame): boolean {
  return hasExactBandIds(sourceBandIds(frame.source), ['low', 'middle', 'high'])
}

export function cloudLayersEncodedGridFrameSpec(frame: RasterFrame): EncodedGridFrameSpec {
  if (!isCloudLayersRasterFrame(frame)) {
    throw new Error('Cloud layers received non-cloud raster source')
  }

  return encodedRasterFrameSpec({
    raster: frame.raster,
    expectedBandIds: sourceBandIds(frame.source),
    label: `cloud layers ${frame.raster.artifactId}`,
  })
}

export function cloudLayerColorUniforms(frame: RasterFrame): CloudLayerColorUniforms {
  return {
    u_low_cloud_color: cloudBandColor(frame, 'low'),
    u_middle_cloud_color: cloudBandColor(frame, 'middle'),
    u_high_cloud_color: cloudBandColor(frame, 'high'),
  }
}

function cloudBandColor(
  frame: RasterFrame,
  bandId: 'low' | 'middle' | 'high'
): [number, number, number] {
  const band = frame.source.bands.find((entry) => entry.id === bandId)
  if (!band) {
    throw new Error(`Cloud layers missing ${bandId} band palette`)
  }
  const color = samplePaletteColor(getRasterPalette(band.paletteId).stops, 100, 'interpolated')
  return [color[0] / 255, color[1] / 255, color[2] / 255]
}

export { CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE }
