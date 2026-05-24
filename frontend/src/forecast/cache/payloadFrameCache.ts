import {
  forecastRunScopeKey,
  type ActiveForecastRun,
  type FramePayloadRef,
} from '@/forecast/manifest'
import {
  createPayloadCache,
  type PayloadCacheLimits,
} from './payloadCache'

const DEFAULT_FRAME_PAYLOAD_CACHE_LIMITS: PayloadCacheLimits = {
  memoryBytes: 128 * 1024 * 1024,
  persistedBytes: 384 * 1024 * 1024,
}

const payloadFrameCache = createPayloadCache({
  dbName: 'weather-map-frame-payload-cache',
  storeName: 'payloads',
  defaultLimits: DEFAULT_FRAME_PAYLOAD_CACHE_LIMITS,
})

export function payloadFrameCacheKey(
  activeRun: ActiveForecastRun,
  frameRef: Pick<FramePayloadRef, 'path' | 'byteLength'>
): string {
  return [
    forecastRunScopeKey(activeRun),
    frameRef.path,
    String(frameRef.byteLength),
  ].join(':')
}

export async function ensurePayloadFrameCacheScope(
  activeRun: ActiveForecastRun
): Promise<void> {
  await payloadFrameCache.activateScope(forecastRunScopeKey(activeRun))
}

export async function readCachedPayloadFrame(
  key: string
): Promise<ArrayBuffer | null> {
  return payloadFrameCache.read(key)
}

export async function writeCachedPayloadFrame(args: {
  activeRun: ActiveForecastRun
  key: string
  payload: ArrayBuffer
}): Promise<void> {
  await payloadFrameCache.write({
    scopeKey: forecastRunScopeKey(args.activeRun),
    key: args.key,
    payload: args.payload,
  })
}

export async function __resetPayloadFrameCacheForTests(): Promise<void> {
  await payloadFrameCache.resetForTests()
}

export async function __flushPayloadFrameCacheForTests(): Promise<void> {
  await payloadFrameCache.flushForTests()
}

export function __setPayloadFrameCacheLimitsForTests(limits: {
  memoryBytes?: number
  persistedBytes?: number
}) {
  payloadFrameCache.setLimitsForTests(limits)
}
