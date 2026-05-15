import {
  layerSourceKey,
  type LayerSpec,
  type ParticleLayerSpec,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { interpolationWindowMinuteOffset, type ForecastInterpolationWindow } from '../forecast-time'
import type { CycleManifest } from '../manifest'
import { normalizeHourToken } from './window'

export const NO_PARTICLES_KEY = 'particles:none'

export function createForecastDataRequestKey(args: {
  manifest: CycleManifest
  selectedLayer: LayerSpec
  selectedParticleLayer: ParticleLayerSpec | null
  interpolationWindow: ForecastInterpolationWindow
  retryToken: number
}): string {
  const lowerHourToken = normalizeHourToken(args.interpolationWindow.lowerHourToken)
  const upperHourToken = normalizeHourToken(args.interpolationWindow.upperHourToken)
  const minuteOffset = interpolationWindowMinuteOffset(args.interpolationWindow)
  return scopeForecastDataKey(
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
  return scopeForecastDataKey(manifest, createLayerRequestKey(layer))
}

export function createParticleChannelKey(
  manifest: CycleManifest,
  particleLayer: ParticleLayerSpec
): string {
  return scopeForecastDataKey(
    manifest,
    particleLayerSourceArtifactId(particleLayer)
  )
}

export function createFieldTimeSliceCacheKey(args: {
  manifest: CycleManifest
  layer: LayerSpec
  hourToken: string
}): string {
  return scopeForecastDataKey(
    args.manifest,
    `${createLayerRequestKey(args.layer)}:${normalizeHourToken(args.hourToken)}`
  )
}

function scopeForecastDataKey(
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
    ? NO_PARTICLES_KEY
    : `particles:${particleLayerSourceArtifactId(particleLayer)}`
}
