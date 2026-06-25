import type { ParticlesWindow } from '@/forecast/frames'
import {
  sourceBandIds,
} from '@/forecast/catalog/source'
import { encodedRasterBandIdMismatch } from '../../encodedGrid'

type ParticleFrame = ParticlesWindow['lower']

export type VectorFramePair = {
  lowerFrame: ParticleFrame
  upperFrame: ParticleFrame
  timeMix: number
}

export function createVectorFramePair(
  window: ParticlesWindow,
): VectorFramePair | null {
  const lowerFrame = window.lower
  const canBlend = window.mix > 0
  const upperFrame = canBlend ? window.upper : window.lower

  if (!validateVectorFrame(lowerFrame)) {
    return null
  }
  if (upperFrame !== lowerFrame && !validateVectorFrame(upperFrame)) {
    return null
  }

  return {
    lowerFrame,
    upperFrame,
    timeMix: upperFrame === lowerFrame ? 0 : window.mix,
  }
}

export function vectorFramePairSignature(framePair: VectorFramePair | null): string | null {
  if (!framePair) return null
  return [
    framePair.lowerFrame.raster.artifactId,
    framePair.lowerFrame.raster.frameId,
    framePair.upperFrame.raster.frameId,
  ].join(':')
}

function validateVectorFrame(frame: ParticleFrame): boolean {
  const componentBytes = frame.raster.grid.nx * frame.raster.grid.ny
  const [u, v] = frame.raster.bands
  const bandMismatch = encodedRasterBandIdMismatch({
    raster: frame.raster,
    expectedBandIds: sourceBandIds(frame.source.source),
    label: 'particles vector',
  })
  if (bandMismatch) {
    console.warn(`[particles] ${bandMismatch}`)
    return false
  }
  if (u.length !== componentBytes || v.length !== componentBytes) {
    console.warn('[particles] unexpected vector component sizes')
    return false
  }

  return true
}
