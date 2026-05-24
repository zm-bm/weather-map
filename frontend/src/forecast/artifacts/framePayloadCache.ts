import {
  forecastRunScopeKey,
  type ActiveForecastRun,
  type FramePayloadRef,
} from '@/forecast/manifest'
import {
  createPayloadCache,
  type PayloadCacheLimits,
} from '@/forecast/cache/payloadCache'

const DEFAULT_FRAME_PAYLOAD_CACHE_LIMITS: PayloadCacheLimits = {
  memoryBytes: 128 * 1024 * 1024,
  persistedBytes: 384 * 1024 * 1024,
}

const framePayloadCache = createPayloadCache({
  dbName: 'weather-map-frame-payload-cache',
  storeName: 'payloads',
  defaultLimits: DEFAULT_FRAME_PAYLOAD_CACHE_LIMITS,
})

export function framePayloadCacheKey(
  activeRun: ActiveForecastRun,
  frameRef: Pick<FramePayloadRef, 'path' | 'byteLength'>
): string {
  return [
    forecastRunScopeKey(activeRun),
    frameRef.path,
    String(frameRef.byteLength),
  ].join(':')
}

export async function ensureFramePayloadCacheScope(
  activeRun: ActiveForecastRun
): Promise<void> {
  await framePayloadCache.activateScope(forecastRunScopeKey(activeRun))
}

export async function readCachedFramePayload(
  key: string
): Promise<ArrayBuffer | null> {
  return framePayloadCache.read(key)
}

export async function writeCachedFramePayload(args: {
  activeRun: ActiveForecastRun
  key: string
  payload: ArrayBuffer
}): Promise<void> {
  await framePayloadCache.write({
    scopeKey: forecastRunScopeKey(args.activeRun),
    key: args.key,
    payload: args.payload,
  })
}

export async function __resetFramePayloadCacheForTests(): Promise<void> {
  await framePayloadCache.resetForTests()
}

export async function __flushFramePayloadCacheForTests(): Promise<void> {
  await framePayloadCache.flushForTests()
}

export function __setFramePayloadCacheLimitsForTests(limits: {
  memoryBytes?: number
  persistedBytes?: number
}) {
  framePayloadCache.setLimitsForTests(limits)
}
