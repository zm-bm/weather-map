import {
  layerSourceKey,
  type LayerSpec,
  type ParticleLayerSpec,
  particleLayerSourceProductId,
} from '../forecast-catalog'
import { frameWindowMinuteOffset, type ForecastFrameWindow } from '../forecast-time'
import type { CycleManifest } from '../manifest'
import { normalizeFrameHourToken } from './window'

export const NO_PARTICLES_FRAME_KEY = 'particles:none'

export function createForecastFrameRequestKey(args: {
  manifest: CycleManifest
  selectedLayer: LayerSpec
  selectedParticleLayer: ParticleLayerSpec | null
  frameWindow: ForecastFrameWindow
  retryToken: number
}): string {
  const lowerHourToken = normalizeFrameHourToken(args.frameWindow.lowerHourToken)
  const upperHourToken = normalizeFrameHourToken(args.frameWindow.upperHourToken)
  const minuteOffset = frameWindowMinuteOffset(args.frameWindow)
  return scopeForecastFrameKey(
    args.manifest,
    [
      createLayerRequestKey(args.selectedLayer),
      createParticleRequestKey(args.selectedParticleLayer),
      lowerHourToken,
      upperHourToken,
      minuteOffset,
      args.retryToken,
    ].join(':')
  )
}

export function createFieldChannelKey(
  manifest: CycleManifest,
  layer: LayerSpec
): string {
  return scopeForecastFrameKey(manifest, createLayerRequestKey(layer))
}

export function createParticleChannelKey(
  manifest: CycleManifest,
  particleLayer: ParticleLayerSpec
): string {
  return scopeForecastFrameKey(
    manifest,
    particleLayerSourceProductId(particleLayer)
  )
}

export function createFieldFrameCacheKey(args: {
  manifest: CycleManifest
  layer: LayerSpec
  hourToken: string
}): string {
  return scopeForecastFrameKey(
    args.manifest,
    `${createLayerRequestKey(args.layer)}:${normalizeFrameHourToken(args.hourToken)}`
  )
}

function scopeForecastFrameKey(
  manifest: CycleManifest,
  value: string
): string {
  return `${manifest.run.cycle}:${manifest.run.revision}:${value}`
}

function createLayerRequestKey(layer: LayerSpec): string {
  return `${layer.id}:${layerSourceKey(layer.source)}`
}

function createParticleRequestKey(particleLayer: ParticleLayerSpec | null): string {
  return particleLayer == null
    ? NO_PARTICLES_FRAME_KEY
    : `particles:${particleLayerSourceProductId(particleLayer)}`
}
