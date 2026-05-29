import type { EncodedRasterFrame } from '@/forecast/frames'
import {
  EncodedGridTextureCache,
  type EncodedGridBand,
} from './texture'

type GridSpec = EncodedRasterFrame['grid']

export type EncodedGridFrameSpec = {
  key: string
  grid: GridSpec
  bands: readonly EncodedGridBand[]
  label: string
}

export function encodedRasterFrameSpec(args: {
  raster: EncodedRasterFrame
  expectedBandIds: readonly string[]
  label: string
}): EncodedGridFrameSpec {
  assertEncodedRasterBandIds(args)
  return {
    key: args.raster.cacheKey,
    grid: args.raster.grid,
    bands: args.raster.bands,
    label: args.label,
  }
}

export function assertEncodedRasterBandIds(args: {
  raster: EncodedRasterFrame
  expectedBandIds: readonly string[]
  label: string
}): void {
  const mismatch = encodedRasterBandIdMismatch(args)
  if (mismatch) throw new Error(mismatch)
}

export function encodedRasterBandIdMismatch(args: {
  raster: EncodedRasterFrame
  expectedBandIds: readonly string[]
  label: string
}): string | null {
  if (rasterBandIdsMatch(args.raster.bandIds, args.expectedBandIds)) {
    return null
  }
  return `${args.label} requires bands ${args.expectedBandIds.join(', ')}; got ${args.raster.bandIds.join(', ')}`
}

export type EncodedFramePair<TFrame> = {
  lowerFrame: TFrame
  upperFrame: TFrame
  lowerTexture: WebGLTexture
  upperTexture: WebGLTexture
  timeMix: number
}

export function resolveEncodedFramePair<TFrame>(args: {
  gl: WebGL2RenderingContext
  textureCache: EncodedGridTextureCache
  current: EncodedFramePair<TFrame> | null
  lowerFrame: TFrame
  upperFrame: TFrame
  mix: number
  frameSpec: (frame: TFrame) => EncodedGridFrameSpec
}): EncodedFramePair<TFrame> | null {
  const upperFrame = args.mix > 0 ? args.upperFrame : args.lowerFrame
  const lowerSpec = args.frameSpec(args.lowerFrame)
  const upperSpec = upperFrame === args.lowerFrame ? lowerSpec : args.frameSpec(upperFrame)
  validateEncodedGridFrameSpec(lowerSpec)
  validateEncodedGridFrameSpec(upperSpec)

  const reusableLowerTexture = findReusableEncodedFrameTexture(args.current, args.lowerFrame)
  const reusableUpperTexture = upperFrame === args.lowerFrame
    ? reusableLowerTexture
    : findReusableEncodedFrameTexture(args.current, upperFrame)
  const lowerTexture = reusableLowerTexture ?? createCachedEncodedFrameTexture({
    gl: args.gl,
    textureCache: args.textureCache,
    spec: lowerSpec,
  })
  if (!lowerTexture) return null

  const upperTexture = upperFrame === args.lowerFrame
    ? lowerTexture
    : reusableUpperTexture ?? createCachedEncodedFrameTexture({
      gl: args.gl,
      textureCache: args.textureCache,
      spec: upperSpec,
    })
  if (!upperTexture) return null

  return {
    lowerFrame: args.lowerFrame,
    upperFrame,
    lowerTexture,
    upperTexture,
    timeMix: upperFrame === args.lowerFrame ? 0 : args.mix,
  }
}

function findReusableEncodedFrameTexture<TFrame>(
  current: EncodedFramePair<TFrame> | null,
  frame: TFrame
): WebGLTexture | null {
  if (!current) return null
  if (current.lowerFrame === frame) return current.lowerTexture
  if (current.upperFrame === frame) return current.upperTexture
  return null
}

function createCachedEncodedFrameTexture(args: {
  gl: WebGL2RenderingContext
  textureCache: EncodedGridTextureCache
  spec: EncodedGridFrameSpec
}): WebGLTexture | null {
  return args.textureCache.getOrCreate(args.gl, {
    key: args.spec.key,
    grid: args.spec.grid,
    bands: args.spec.bands,
  })
}

function rasterBandIdsMatch(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((id, index) => id === expected[index])
}

export function validateEncodedGridFrameSpec(spec: EncodedGridFrameSpec): void {
  const expectedCellCount = spec.grid.nx * spec.grid.ny
  for (const band of spec.bands) {
    if (band.length !== expectedCellCount) {
      throw new Error(`Unexpected ${spec.label} grid size: got=${band.length} expected=${expectedCellCount}`)
    }
  }
}

export function encodedGridUniforms(grid: GridSpec): {
  u_grid_size: [number, number]
  u_lon0: number
  u_lat0: number
  u_dx: number
  u_dy: number
} {
  return {
    u_grid_size: [grid.nx, grid.ny],
    u_lon0: grid.lon0,
    u_lat0: grid.lat0,
    u_dx: grid.dx,
    u_dy: grid.dy,
  }
}

export function encodedFramePairUniforms<TFrame>(
  framePair: EncodedFramePair<TFrame>
): {
  u_encoded_tex_lower: WebGLTexture
  u_encoded_tex_upper: WebGLTexture
  u_grid_size: [number, number]
  u_lon0: number
  u_lat0: number
  u_dx: number
  u_dy: number
  u_time_mix: number
} {
  const grid = encodedFrameGrid(framePair.lowerFrame)
  return {
    u_encoded_tex_lower: framePair.lowerTexture,
    u_encoded_tex_upper: framePair.upperTexture,
    ...encodedGridUniforms(grid),
    u_time_mix: framePair.timeMix,
  }
}

function encodedFrameGrid(frame: unknown): GridSpec {
  const maybeFrame = frame as { grid?: GridSpec; raster?: { grid?: GridSpec } }
  const grid = maybeFrame.grid ?? maybeFrame.raster?.grid
  if (!grid) throw new Error('Encoded frame is missing grid metadata')
  return grid
}

export type EncodedLinearUniformSource = {
  hasNodata?: number
  nodata?: number | null
  scale: number
  offset: number
}

export function encodedLinearUniforms(source: EncodedLinearUniformSource): {
  u_has_nodata: number
  u_nodata: number
  u_scale: number
  u_offset: number
} {
  return {
    u_has_nodata: source.hasNodata ?? (source.nodata == null ? 0 : 1),
    u_nodata: source.nodata ?? 0,
    u_scale: source.scale,
    u_offset: source.offset,
  }
}
