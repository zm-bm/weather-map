import type {
  GridSpec,
  ManifestEncodingSpec,
} from '@/forecast/manifest'
import type {
  ForecastLayerSource,
  ContourSource,
  OverlaySource,
  ParticleSource,
} from '@/forecast/catalog/source'

export type EncodedRasterBand = Int8Array

export type EncodedRasterFrame = {
  hourToken: string
  artifactId: string
  cacheKey: string
  grid: GridSpec
  encoding: ManifestEncodingSpec
  bandIds: readonly string[]
  bands: readonly EncodedRasterBand[]
}

export type RasterLayerFrame<TSource> = {
  source: TSource
  raster: EncodedRasterFrame
}

export type ForecastFrameMap = {
  raster: RasterLayerFrame<ForecastLayerSource>
  overlay: readonly RasterLayerFrame<OverlaySource>[]
  contour: RasterLayerFrame<ContourSource>
  particles: RasterLayerFrame<ParticleSource>
}

export type ForecastWindowId = keyof ForecastFrameMap

export type FrameWindow<T> = {
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  lower: T
  upper: T
}

export type ForecastWindow<K extends ForecastWindowId> =
  FrameWindow<ForecastFrameMap[K]>

export type RasterWindow = ForecastWindow<'raster'>
export type OverlayWindow = ForecastWindow<'overlay'>
export type ContourWindow = ForecastWindow<'contour'>
export type ParticlesWindow = ForecastWindow<'particles'>
export type ProbeWindow = RasterWindow

export type ForecastWindows = Partial<{
  [K in ForecastWindowId]: ForecastWindow<K>
}>
