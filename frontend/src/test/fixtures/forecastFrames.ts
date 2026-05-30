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
  hourToken?: string
  cacheKey?: string
  grid?: GridSpec
  encoding?: ManifestEncodingSpec
  frame?: number
}): RasterLayerFrame<TSource> {
  const hourToken = args.hourToken ?? '000'
  const frame = {
    source: args.source,
    raster: {
      hourToken,
      artifactId: args.artifactId,
      cacheKey: args.cacheKey ?? `fixture:raster:${args.artifactId}:${hourToken}`,
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
  hourToken?: string
  layerId?: string
  values?: number[] | Int8Array
  display?: ForecastDisplayProfile
  displayProfile?: DisplayProfileId
  frame?: number
} = {}): RasterFixtureFrame {
  const values = args.values instanceof Int8Array
    ? args.values
    : new Int8Array(args.values ?? [1, 2, 3, 4])
  const hourToken = args.hourToken ?? '000'
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
    hourToken,
    cacheKey: `fixture:raster:${layerId}:${hourToken}`,
    encoding: createScalarEncodingFixture({ scale: 1 }),
    bandIds: ['value'],
    bands: [values],
    frame: args.frame,
  }) as RasterFixtureFrame
}

export function createUvRasterFrameFixture(args: {
  hourToken?: string
  layerId?: string
  artifactId?: string
  u?: readonly number[] | Int8Array
  v?: readonly number[] | Int8Array
  encoding?: ManifestEncodingSpec
} = {}): RasterFixtureFrame {
  const hourToken = args.hourToken ?? '000'
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
    hourToken,
    cacheKey: `fixture:uv:${artifactId}:${hourToken}`,
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
  lowerHourToken?: string
  upperHourToken?: string
  frame?: number
} = {}): RasterWindow {
  const lower = args.lower ?? createRasterFrameFixture({
    hourToken: args.lowerHourToken,
    layerId: args.layerId,
    frame: args.frame,
  })
  const upper = args.upper ?? createRasterFrameFixture({
    hourToken: args.upperHourToken,
    layerId: args.layerId,
    frame: args.frame,
  })

  return {
    lower,
    upper,
    selectedValidTimeMs: args.selectedValidTimeMs ?? Date.UTC(2026, 3, 13, 12),
    lowerHourToken: lower.raster.hourToken,
    upperHourToken: upper.raster.hourToken,
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
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: args.mix ?? 0,
  }
}

export function createCloudLayersRasterFrameFixture(args: {
  hourToken?: string
  layerId?: string
  artifactId?: string
} = {}): RasterFixtureFrame {
  const hourToken = args.hourToken ?? '000'
  const layerId = args.layerId ?? 'cloud_layers'
  const artifactId = args.artifactId ?? 'cloud_layers'

  return createRasterLayerFrameFixture({
    source: createCloudLayersRasterSourceFixture({ layerId, artifactId }),
    artifactId,
    hourToken,
    cacheKey: `fixture:cloud:${artifactId}:${hourToken}`,
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
  hourToken?: string
  artifactId?: string
} = {}): OverlayFixtureFrame {
  const hourToken = args.hourToken ?? '000'
  const artifactId = args.artifactId ?? 'precip_type_surface'
  return createRasterLayerFrameFixture({
    source: createOverlaySourceFixture({ artifactId }),
    artifactId,
    hourToken,
    cacheKey: `fixture:precip:${artifactId}:${hourToken}`,
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
  hourToken?: string
  overlays?: readonly OverlayFixtureFrame[]
} = {}): ForecastFrameMap['overlay'] {
  const hourToken = args.hourToken ?? '000'
  return args.overlays ?? [createPrecipitationTypeOverlayFixture({ hourToken })]
}

export function createOverlayWindowFixture(args: {
  lower?: ForecastFrameMap['overlay']
  upper?: ForecastFrameMap['overlay']
  mix?: number
  lowerHourToken?: string
  upperHourToken?: string
} = {}): OverlayWindow {
  const lower = args.lower ?? createOverlayFrameFixture({ hourToken: args.lowerHourToken })
  const upper = args.upper ?? createOverlayFrameFixture({ hourToken: args.upperHourToken })

  return {
    lower,
    upper,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerHourToken: args.lowerHourToken ?? overlayFrameFixtureHourToken(lower),
    upperHourToken: args.upperHourToken ?? overlayFrameFixtureHourToken(upper),
    mix: args.mix ?? 0,
  }
}

function overlayFrameFixtureHourToken(frame: ForecastFrameMap['overlay']): string {
  return frame[0]?.raster.hourToken ?? '000'
}

export function createPressureFrameFixture(args: {
  hourToken?: string
  artifactId?: string
} = {}): ContourFixtureFrame {
  const hourToken = args.hourToken ?? '000'
  const artifactId = args.artifactId ?? 'prmsl_msl'
  const encoding = createScalarEncodingFixture({
    id: 'prmsl_msl_i8_50pa_v1',
    format: 'linear-i8-v1',
    dtype: 'int8',
    byteOrder: 'none',
    scale: 50,
    offset: 100500,
    nodata: -128,
  })
  return createRasterLayerFrameFixture({
    source: createContourSourceFixture({ artifactId }),
    artifactId,
    hourToken,
    cacheKey: `fixture:contour:${artifactId}:${hourToken}`,
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
    lowerHourToken: lower.raster.hourToken,
    upperHourToken: upper.raster.hourToken,
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
