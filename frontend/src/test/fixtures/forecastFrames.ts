import type {
  ContourWindow,
  ForecastFrameMap,
  ForecastWindows,
  OverlayWindow,
  ParticlesWindow,
  RasterLayerFrame,
  RasterWindow,
} from '@/forecast/frames'
import type {
  DisplayProfileId,
  ForecastDisplayProfile,
} from '@/forecast/display'
import type {
  GridSpec,
  ManifestEncodingSpec,
} from '@/forecast/manifest'
import {
  createGridFixture,
  createScalarEncodingFixture,
  createVectorEncodingFixture,
} from './manifest'
import {
  createCloudLayersRasterSourceFixture,
  createContourSourceFixture,
  createOverlaySourceFixture,
  createParticleSourceFixture,
  createRasterLayerSourceFixture,
} from './forecastSources'

type RasterFixtureFrame = ForecastFrameMap['raster']
type OverlayFixtureFrame = ForecastFrameMap['overlay'][number]
type ContourFixtureFrame = ForecastFrameMap['contour']

function createRasterLayerFrameFixture<TSource>(args: {
  source: TSource
  artifactId: string
  bandIds: readonly string[]
  bands: readonly Int8Array[]
  frameId?: string
  cacheKey?: string
  grid?: GridSpec
  encoding?: ManifestEncodingSpec
  frame?: number
}): RasterLayerFrame<TSource> {
  const frameId = args.frameId ?? '000'
  const frame = {
    source: args.source,
    raster: {
      frameId,
      artifactId: args.artifactId,
      cacheKey: args.cacheKey ?? `fixture:raster:${args.artifactId}:${frameId}`,
      grid: args.grid ?? createGridFixture({ nx: 2, ny: 2 }),
      encoding: args.encoding ?? createScalarEncodingFixture({ scale: 1 }),
      bandIds: args.bandIds,
      bands: args.bands,
    },
    ...(args.frame === undefined ? {} : { frame: args.frame }),
  }

  return frame as RasterLayerFrame<TSource>
}

export function createRasterFrameFixture(args: {
  frameId?: string
  layerId?: string
  values?: number[] | Int8Array
  display?: ForecastDisplayProfile
  displayProfile?: DisplayProfileId
  frame?: number
} = {}): RasterFixtureFrame {
  const values = args.values instanceof Int8Array
    ? args.values
    : new Int8Array(args.values ?? [1, 2, 3, 4])
  const frameId = args.frameId ?? '000'
  const layerId = args.layerId ?? 'temperature'
  const source = createRasterLayerSourceFixture({
    layerId,
    display: args.display,
    displayProfile: args.displayProfile,
    artifactId: layerId,
  })

  return createRasterLayerFrameFixture({
    source,
    artifactId: layerId,
    frameId,
    cacheKey: `fixture:raster:${layerId}:${frameId}`,
    encoding: createScalarEncodingFixture({ scale: 1 }),
    bandIds: ['value'],
    bands: [values],
    frame: args.frame,
  }) as RasterFixtureFrame
}

export function createUvRasterFrameFixture(args: {
  frameId?: string
  layerId?: string
  artifactId?: string
  u?: readonly number[] | Int8Array
  v?: readonly number[] | Int8Array
  encoding?: ManifestEncodingSpec
} = {}): RasterFixtureFrame {
  const frameId = args.frameId ?? '000'
  const layerId = args.layerId ?? 'wind_speed'
  const artifactId = args.artifactId ?? 'wind10m_uv'
  const source = createRasterLayerSourceFixture({
    layerId,
    artifactId,
    displayProfile: 'wind-speed',
    bands: [
      { id: 'u' },
      { id: 'v' },
    ],
  })

  return createRasterLayerFrameFixture({
    source,
    artifactId,
    frameId,
    cacheKey: `fixture:uv:${artifactId}:${frameId}`,
    encoding: args.encoding ?? createVectorEncodingFixture({ scale: 1, offset: 0, nodata: -128 }),
    bandIds: ['u', 'v'],
    bands: [
      args.u instanceof Int8Array ? args.u : Int8Array.from(args.u ?? [1, 2, 3, 4]),
      args.v instanceof Int8Array ? args.v : Int8Array.from(args.v ?? [-1, -2, -3, -4]),
    ],
  }) as RasterFixtureFrame
}

export function createRasterWindowFixture(args: {
  lower?: RasterFixtureFrame
  upper?: RasterFixtureFrame
  layerId?: string
  mix?: number
  selectedValidTimeMs?: number
  lowerFrameId?: string
  upperFrameId?: string
  frame?: number
} = {}): RasterWindow {
  const lower = args.lower ?? createRasterFrameFixture({
    frameId: args.lowerFrameId,
    layerId: args.layerId,
    frame: args.frame,
  })
  const upper = args.upper ?? createRasterFrameFixture({
    frameId: args.upperFrameId,
    layerId: args.layerId,
    frame: args.frame,
  })

  return {
    lower,
    upper,
    selectedValidTimeMs: args.selectedValidTimeMs ?? Date.UTC(2026, 3, 13, 12),
    lowerFrameId: lower.raster.frameId,
    upperFrameId: upper.raster.frameId,
    mix: args.mix ?? 0,
  }
}

export function createParticlesWindowFixture(args: {
  artifactId?: string
  mix?: number
} = {}): ParticlesWindow {
  const artifactId = args.artifactId ?? 'wind10m_uv'
  const slice = createRasterLayerFrameFixture({
    source: createParticleSourceFixture({ artifactId }),
    artifactId,
    cacheKey: `fixture:wind:${artifactId}:000`,
    encoding: createVectorEncodingFixture(),
    bandIds: ['u', 'v'],
    bands: [
      new Int8Array([1, 2, 3, 4]),
      new Int8Array([-1, -2, -3, -4]),
    ],
  }) as ForecastFrameMap['particles']

  return {
    lower: slice,
    upper: slice,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerFrameId: '000',
    upperFrameId: '000',
    mix: args.mix ?? 0,
  }
}

export function createCloudLayersRasterFrameFixture(args: {
  frameId?: string
  layerId?: string
  artifactId?: string
} = {}): RasterFixtureFrame {
  const frameId = args.frameId ?? '000'
  const layerId = args.layerId ?? 'cloud_layers'
  const artifactId = args.artifactId ?? 'cloud_layers'

  return createRasterLayerFrameFixture({
    source: createCloudLayersRasterSourceFixture({ layerId, artifactId }),
    artifactId,
    frameId,
    cacheKey: `fixture:cloud:${artifactId}:${frameId}`,
    grid: createGridFixture({ nx: 2, ny: 2 }),
    encoding: createVectorEncodingFixture({
      id: 'cloud_layers_vector_i8_4pct_v1',
      scale: 4,
      offset: 0,
      nodata: -128,
    }),
    bandIds: ['low', 'middle', 'high'],
    bands: [
      new Int8Array([0, 6, 13, 25]),
      new Int8Array([0, 5, 10, 20]),
      new Int8Array([0, 3, 8, 15]),
    ],
  }) as RasterFixtureFrame
}

function createPrecipitationTypeOverlayFixture(args: {
  frameId?: string
  artifactId?: string
} = {}): OverlayFixtureFrame {
  const frameId = args.frameId ?? '000'
  const artifactId = args.artifactId ?? 'precip_type_surface'
  return createRasterLayerFrameFixture({
    source: createOverlaySourceFixture({ artifactId }),
    artifactId,
    frameId,
    cacheKey: `fixture:precip:${artifactId}:${frameId}`,
    grid: createGridFixture({ nx: 2, ny: 2 }),
    encoding: createVectorEncodingFixture({
      id: 'precip_type_surface_vector_i8_fraction_v1',
      scale: 0.01,
      offset: 0,
      nodata: -128,
    }),
    bandIds: ['snow_frac', 'mix_frac'],
    bands: [
      new Int8Array([0, 25, 50, 100]),
      new Int8Array([0, 10, 20, 40]),
    ],
  }) as OverlayFixtureFrame
}

export function createOverlayFrameFixture(args: {
  frameId?: string
  overlays?: readonly OverlayFixtureFrame[]
} = {}): ForecastFrameMap['overlay'] {
  const frameId = args.frameId ?? '000'
  return args.overlays ?? [createPrecipitationTypeOverlayFixture({ frameId })]
}

export function createOverlayWindowFixture(args: {
  lower?: ForecastFrameMap['overlay']
  upper?: ForecastFrameMap['overlay']
  mix?: number
  lowerFrameId?: string
  upperFrameId?: string
} = {}): OverlayWindow {
  const lower = args.lower ?? createOverlayFrameFixture({ frameId: args.lowerFrameId })
  const upper = args.upper ?? createOverlayFrameFixture({ frameId: args.upperFrameId })

  return {
    lower,
    upper,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerFrameId: args.lowerFrameId ?? overlayFrameFixtureFrameId(lower),
    upperFrameId: args.upperFrameId ?? overlayFrameFixtureFrameId(upper),
    mix: args.mix ?? 0,
  }
}

function overlayFrameFixtureFrameId(frame: ForecastFrameMap['overlay']): string {
  return frame[0]?.raster.frameId ?? '000'
}

export function createPressureFrameFixture(args: {
  frameId?: string
  artifactId?: string
} = {}): ContourFixtureFrame {
  const frameId = args.frameId ?? '000'
  const artifactId = args.artifactId ?? 'prmsl_msl'
  const encoding = createScalarEncodingFixture({
    id: 'prmsl_msl_i8_50pa_v1',
    format: 'linear-i8-v1',
    dtype: 'int8',
    byte_order: 'none',
    scale: 50,
    offset: 100500,
    nodata: -128,
  })
  return createRasterLayerFrameFixture({
    source: createContourSourceFixture({ artifactId }),
    artifactId,
    frameId,
    cacheKey: `fixture:contour:${artifactId}:${frameId}`,
    grid: createGridFixture({ nx: 2, ny: 2 }),
    encoding,
    bandIds: ['value'],
    bands: [new Int8Array([-10, 10, 30, 50])],
  }) as ContourFixtureFrame
}

export function createContourWindowFixture(args: {
  lower?: ContourFixtureFrame
  upper?: ContourFixtureFrame
  mix?: number
} = {}): ContourWindow {
  const lower = args.lower ?? createPressureFrameFixture()
  const upper = args.upper ?? createPressureFrameFixture()

  return {
    lower,
    upper,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerFrameId: lower.raster.frameId,
    upperFrameId: upper.raster.frameId,
    mix: args.mix ?? 0,
  }
}

export function createForecastWindowsFixture(args: {
  raster?: ForecastWindows['raster'] | null
  overlay?: ForecastWindows['overlay'] | null
  contour?: ForecastWindows['contour'] | null
  particles?: ForecastWindows['particles'] | null
} = {}): ForecastWindows {
  const raster = args.raster ?? createRasterWindowFixture()
  const windows: ForecastWindows = {}

  if (raster != null) windows.raster = raster
  if (args.overlay != null) windows.overlay = args.overlay
  if (args.contour != null) windows.contour = args.contour
  if (args.particles === undefined) {
    windows.particles = createParticlesWindowFixture()
  } else if (args.particles != null) {
    windows.particles = args.particles
  }

  return windows
}
