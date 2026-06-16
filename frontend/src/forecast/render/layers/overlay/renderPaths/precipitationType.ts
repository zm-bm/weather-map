import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

import { worldSizeAtZoom, worldWrapForLng } from '@/core/geo'
import { clamp, lerp, smoothstep } from '@/core/math'
import type {
  OverlayWindow,
  RasterLayerFrame,
} from '@/forecast/frames'
import {
  sourceBandIds,
  type OverlaySource,
} from '@/forecast/catalog/source'

import {
  encodedFramePairUniforms,
  encodedLinearUniforms,
  encodedRasterFrameSpec,
  resolveEncodedFramePair,
  type EncodedFramePair,
  type EncodedGridFrameSpec,
  type EncodedGridTextureCache,
} from '../../../encodedGrid'
import {
  drawWrappedWorldCopies,
  type ProgramInfo,
  type WrappedWorldQuad,
} from '../../../gpu'

export const OVERLAY_MIN_PATTERN_ZOOM = 2
export const OVERLAY_MAX_PATTERN_ZOOM = 6
export const OVERLAY_MIN_PATTERN_TILE_PIXELS = 12
export const OVERLAY_MAX_PATTERN_TILE_PIXELS = 30
export const OVERLAY_MASK_MIN = 0.35
export const OVERLAY_MASK_MAX = 0.65
export const OVERLAY_LATTICE_VISIBILITY_MIN = 0.38
export const OVERLAY_LATTICE_VISIBILITY_MAX = 0.88
export const OVERLAY_SNOW_ALPHA = 0.72
export const OVERLAY_MIX_ALPHA = 0.82
export const OVERLAY_SYMBOL_COLOR_RGB = [0.84, 0.95, 1] as const
export const OVERLAY_PATTERN_FADE_OUT_MS = 80
export const OVERLAY_PATTERN_FADE_IN_MS = 180

type LinearRasterEncoding = {
  nodata?: number | null
  scale: number
  offset: number
}

export type PrecipitationTypeOverlayRenderEntry =
  EncodedFramePair<RasterLayerFrame<OverlaySource>> & {
    key: string
  }

export function createPrecipitationTypeOverlayEntries(args: {
  gl: WebGL2RenderingContext
  textureCache: EncodedGridTextureCache
  previousEntries: readonly PrecipitationTypeOverlayRenderEntry[]
  frame: OverlayWindow
}) {
  return pairPrecipitationTypeFrames(args.frame).map(({ lowerFrame, upperFrame }) => {
    const key = precipitationTypeOverlayRasterKey(lowerFrame)
    const framePair = resolveEncodedFramePair({
      gl: args.gl,
      textureCache: args.textureCache,
      current: args.previousEntries.find((entry) => entry.key === key) ??
        null,
      lowerFrame,
      upperFrame,
      mix: args.frame.mix,
      frameSpec: precipitationTypeOverlayRasterSpec,
    })
    if (!framePair) throw new Error('Failed to create precipitation type overlay textures')
    return { key, ...framePair }
  })
}

function pairPrecipitationTypeFrames(frame: OverlayWindow) {
  const byKey = new Map<string, {
    lowerFrame?: RasterLayerFrame<OverlaySource>
    upperFrame?: RasterLayerFrame<OverlaySource>
  }>()
  for (const lowerFrame of frame.lower) {
    byKey.set(precipitationTypeOverlayRasterKey(lowerFrame), { lowerFrame })
  }
  for (const upperFrame of frame.upper) {
    const key = precipitationTypeOverlayRasterKey(upperFrame)
    byKey.set(key, { ...byKey.get(key), upperFrame })
  }
  return Array.from(byKey.values()).map((entry) => {
    const lowerFrame = entry.lowerFrame ?? entry.upperFrame
    const upperFrame = entry.upperFrame ?? entry.lowerFrame
    if (!lowerFrame || !upperFrame) throw new Error('Invalid precipitation type overlay frame pair')
    return { lowerFrame, upperFrame }
  })
}

function precipitationTypeOverlayRasterSpec(frame: RasterLayerFrame<OverlaySource>): EncodedGridFrameSpec {
  if (frame.source.style !== 'precipitation-type-pattern') {
    throw new Error(`Unsupported overlay style ${frame.source.style}`)
  }
  return encodedRasterFrameSpec({
    raster: frame.raster,
    expectedBandIds: sourceBandIds(frame.source.source),
    label: `overlay ${frame.source.id}`,
  })
}

function precipitationTypeOverlayRasterKey(
  frame: RasterLayerFrame<OverlaySource>
): string {
  return `${frame.source.style}:${frame.source.id}:${frame.raster.artifactId}`
}

export function drawPrecipitationTypeOverlayEntry(args: {
  gl: WebGL2RenderingContext
  map: MapLibreMap
  programInfo: ProgramInfo
  quad: WrappedWorldQuad
  entry: PrecipitationTypeOverlayRenderEntry
  matrix: CustomRenderMethodInput['modelViewProjectionMatrix']
  patternOpacity: number
}): void {
  const { entry } = args
  drawWrappedWorldCopies({
    gl: args.gl,
    programInfo: args.programInfo,
    quad: args.quad,
    centerWrap: worldWrapForLng(args.map.getCenter().lng),
    uniforms: {
      ...encodedFramePairUniforms(entry),
      ...encodedLinearUniforms(entry.lowerFrame.raster.encoding as LinearRasterEncoding),
      u_matrix: args.matrix,
      u_world_size: worldSizeAtZoom(args.map.getZoom()),
      u_pattern_opacity: args.patternOpacity,
    },
  })
}

export function stepPatternOpacity(args: {
  opacity: number
  target: number
  elapsedMs: number
}) {
  const opacity = normalizePatternOpacity(args.opacity)
  const target = normalizePatternOpacity(args.target)
  if (Math.abs(opacity - target) <= 0.001) {
    return { opacity: target, needsRepaint: false }
  }

  const elapsedMs = Math.max(0, Number.isFinite(args.elapsedMs) ? args.elapsedMs : 0)
  const durationMs = target < opacity
    ? OVERLAY_PATTERN_FADE_OUT_MS
    : OVERLAY_PATTERN_FADE_IN_MS
  const maxStep = durationMs <= 0 ? 1 : elapsedMs / durationMs
  const delta = clamp(target - opacity, -maxStep, maxStep)
  const nextOpacity = normalizePatternOpacity(opacity + delta)

  return {
    opacity: nextOpacity,
    needsRepaint: Math.abs(nextOpacity - target) > 0.001,
  }
}

export function normalizePatternOpacity(value: number) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

export function overlayPatternTilePixelsForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return OVERLAY_MAX_PATTERN_TILE_PIXELS
  const t = clamp(
    (zoom - OVERLAY_MIN_PATTERN_ZOOM) /
      Math.max(1e-6, OVERLAY_MAX_PATTERN_ZOOM - OVERLAY_MIN_PATTERN_ZOOM),
    0,
    1
  )
  return lerp(OVERLAY_MIN_PATTERN_TILE_PIXELS, OVERLAY_MAX_PATTERN_TILE_PIXELS, t)
}

export function precipTypeOverlayPatternWeights(args: {
  snowFrac: number
  mixFrac: number
}) {
  const snowFrac = normalizePatternOpacity(args.snowFrac)
  const mixFrac = normalizePatternOpacity(args.mixFrac)
  const mixMask = smoothstep(OVERLAY_MASK_MIN, OVERLAY_MASK_MAX, mixFrac)
  const snowMask = smoothstep(OVERLAY_MASK_MIN, OVERLAY_MASK_MAX, snowFrac) * (1 - mixMask)
  const snowLatticeVisibility = smoothstep(
    OVERLAY_LATTICE_VISIBILITY_MIN,
    OVERLAY_LATTICE_VISIBILITY_MAX,
    snowFrac
  ) * snowMask
  const mixLatticeVisibility = smoothstep(
    OVERLAY_LATTICE_VISIBILITY_MIN,
    OVERLAY_LATTICE_VISIBILITY_MAX,
    mixFrac
  ) * mixMask
  return {
    snowMask,
    mixMask,
    snowLatticeVisibility,
    mixLatticeVisibility,
    snowAlphaWeight: snowMask * OVERLAY_SNOW_ALPHA,
    mixAlphaWeight: mixMask * OVERLAY_MIX_ALPHA,
  }
}
