import {
  layerSourceKey,
  type LayerSpec,
  type ParticleLayerSpec,
  type PrecipitationTypeLayerOverlay,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { interpolationWindowMinuteOffset, type ForecastInterpolationWindow } from '../forecast-time'
import {
  forecastRunScopeKey,
  type ActiveForecastRun,
} from '../forecast-manifest'
import { normalizeHourToken } from './window'

export const NO_PARTICLES_KEY = 'particles:none'
export const NO_PRECIP_TYPE_OVERLAY_KEY = 'precip-type-overlay:none'

export function createForecastDataRequestKey(args: {
  activeRun: ActiveForecastRun
  selectedLayer: LayerSpec
  selectedParticleLayer: ParticleLayerSpec | null
  interpolationWindow: ForecastInterpolationWindow
  retryToken: number
}): string {
  const lowerHourToken = normalizeHourToken(args.interpolationWindow.lowerHourToken)
  const upperHourToken = normalizeHourToken(args.interpolationWindow.upperHourToken)
  const minuteOffset = interpolationWindowMinuteOffset(args.interpolationWindow)
  return scopeForecastDataKey(
    args.activeRun,
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
  activeRun: ActiveForecastRun,
  layer: LayerSpec
): string {
  return scopeForecastDataKey(activeRun, createLayerRequestKey(layer))
}

export function createParticleChannelKey(
  activeRun: ActiveForecastRun,
  particleLayer: ParticleLayerSpec
): string {
  return scopeForecastDataKey(
    activeRun,
    createParticleLayerRequestKey(particleLayer)
  )
}

export function createPrecipTypeOverlayChannelKey(
  activeRun: ActiveForecastRun,
  overlay: PrecipitationTypeLayerOverlay
): string {
  return scopeForecastDataKey(
    activeRun,
    createPrecipTypeOverlayRequestKey(overlay)
  )
}

export function createFieldTimeSliceCacheKey(args: {
  activeRun: ActiveForecastRun
  layer: LayerSpec
  hourToken: string
}): string {
  return scopeForecastDataKey(
    args.activeRun,
    `${createLayerRequestKey(args.layer)}:${normalizeHourToken(args.hourToken)}`
  )
}

function scopeForecastDataKey(
  activeRun: ActiveForecastRun,
  value: string
): string {
  return `${forecastRunScopeKey(activeRun)}:${value}`
}

function createLayerRequestKey(layer: LayerSpec): string {
  return `${layer.id}:${layerSourceKey(layer.source)}`
}

function createParticleRequestKey(particleLayer: ParticleLayerSpec | null): string {
  return particleLayer == null
    ? NO_PARTICLES_KEY
    : `particles:${createParticleLayerRequestKey(particleLayer)}`
}

function createParticleLayerRequestKey(particleLayer: ParticleLayerSpec): string {
  return `${particleLayer.id}:${particleLayerSourceArtifactId(particleLayer)}`
}

function createPrecipTypeOverlayRequestKey(overlay: PrecipitationTypeLayerOverlay): string {
  return `precip-type-overlay:${overlay.id}:${overlay.artifactId}`
}
