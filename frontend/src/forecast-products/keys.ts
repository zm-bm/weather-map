import {
  layerSourceKey,
  type LayerSpec,
  type PrecipitationTypeLayerOverlay,
} from '../forecast-catalog'
import {
  forecastRunScopeKey,
  type ActiveForecastRun,
} from '../forecast-manifest'
import { normalizeForecastHourToken } from '../forecast-manifest'
import type { WindVectorSource } from './target'

export const NO_PRODUCTS_KEY = 'products:none'

export function createFieldChannelKey(
  activeRun: ActiveForecastRun,
  layer: LayerSpec
): string {
  return scopeForecastProductKey(activeRun, createLayerRequestKey(layer))
}

export function createWindVectorChannelKey(
  activeRun: ActiveForecastRun,
  source: WindVectorSource
): string {
  return scopeForecastProductKey(
    activeRun,
    createWindVectorRequestKey(source)
  )
}

export function createCloudLayersChannelKey(
  activeRun: ActiveForecastRun,
  layer: LayerSpec
): string {
  return scopeForecastProductKey(activeRun, createLayerRequestKey(layer))
}

export function createPrecipTypeChannelKey(
  activeRun: ActiveForecastRun,
  overlay: PrecipitationTypeLayerOverlay
): string {
  return scopeForecastProductKey(
    activeRun,
    createPrecipTypeRequestKey(overlay)
  )
}

export function createPressureChannelKey(
  activeRun: ActiveForecastRun,
  artifactId: string
): string {
  return scopeForecastProductKey(
    activeRun,
    `pressure:${artifactId}`
  )
}

export function createForecastProductRequestKey(args: {
  activeRun: ActiveForecastRun
  productKeys: readonly string[]
  lowerHourToken: string
  upperHourToken: string
  minuteOffset: number
  retryToken: number
}): string {
  const productsKey = args.productKeys.length === 0
    ? scopeForecastProductKey(args.activeRun, NO_PRODUCTS_KEY)
    : args.productKeys.join('|')
  return [
    productsKey,
    normalizeForecastHourToken(args.lowerHourToken),
    normalizeForecastHourToken(args.upperHourToken),
    args.minuteOffset,
    args.retryToken,
  ].join(':')
}

export function createFieldTimeSliceCacheKey(args: {
  activeRun: ActiveForecastRun
  layer: LayerSpec
  hourToken: string
}): string {
  return scopeForecastProductKey(
    args.activeRun,
    `${createLayerRequestKey(args.layer)}:${normalizeForecastHourToken(args.hourToken)}`
  )
}

export function createCloudLayersTimeSliceCacheKey(args: {
  activeRun: ActiveForecastRun
  layer: LayerSpec
  hourToken: string
}): string {
  return scopeForecastProductKey(
    args.activeRun,
    `${createLayerRequestKey(args.layer)}:${normalizeForecastHourToken(args.hourToken)}`
  )
}

function scopeForecastProductKey(
  activeRun: ActiveForecastRun,
  value: string
): string {
  return `${forecastRunScopeKey(activeRun)}:${value}`
}

function createLayerRequestKey(layer: LayerSpec): string {
  return `${layer.id}:${layerSourceKey(layer.source)}`
}

function createWindVectorRequestKey(source: WindVectorSource): string {
  return `wind-vectors:${source.id}:${source.artifactId}`
}

function createPrecipTypeRequestKey(overlay: PrecipitationTypeLayerOverlay): string {
  return `precip-type:${overlay.id}:${overlay.artifactId}`
}
