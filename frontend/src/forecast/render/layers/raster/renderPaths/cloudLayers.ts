import {
  hasExactBandIds,
  sourceBandIds,
} from '@/forecast/catalog/source'
import type { RasterWindow } from '@/forecast/frames'
import {
  samplePaletteColor,
} from '@/forecast/display/palette'
import {
  encodedRasterFrameSpec,
  type EncodedGridFrameSpec,
} from '../../../encodedGrid'

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
  if (frame.source.display.kind !== 'cloud-layers') {
    throw new Error(`Cloud layers received ${frame.source.display.kind} display profile`)
  }
  const band = frame.source.bands.find((entry) => entry.id === bandId)
  if (!band) {
    throw new Error(`Cloud layers missing ${bandId} band palette`)
  }
  const palette = frame.source.display.bandPalettes[band.id]
  if (!palette) {
    throw new Error(`Cloud layers missing ${band.id} band palette`)
  }
  const color = samplePaletteColor(palette.stops, 100, 'interpolated')
  return [color[0] / 255, color[1] / 255, color[2] / 255]
}
